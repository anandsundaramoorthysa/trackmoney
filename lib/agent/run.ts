import { logAgentEvent } from "@/lib/audit";
import { formatPaise } from "@/lib/money";
import type { Conversation, User } from "@/lib/db/schema";
import { computeUsageFacts, hasUpgradeCase, type UsageFacts } from "@/lib/facts";
import {
  getOrCreateConversation,
  hasPendingDraft,
  setConversationState,
  transcript,
} from "./conversation";
import {
  answerTemplate,
  cannotAnswerTemplate,
  checkClaims,
  checkGrounding,
  declineTemplate,
  declinedAnswerTemplate,
  greetingTemplate,
  identityTemplate,
  offTopicTemplate,
  proAnswerTemplate,
  proposalTemplate,
  reopenAfterDeclineTemplate,
  suggestionTemplate,
} from "./grounding";
import { dismissUpgradeNotifications } from "@/lib/notifications/store";
import { classifyTopic } from "./answers";
import { classifyIntent, INTENT_EXPLANATION, type Intent } from "./intent";
import type { TransactionProposal } from "@/lib/agent/proposal";
import { callLLM, parseJsonLoosely, type LlmProvider } from "./llm";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import {
  isToolName,
  TOOL_NAMES,
  runCreateCheckoutOrder,
  runExplainSuggestion,
  runProposeTransaction,
  type CheckoutHandoff,
  type ToolContext,
  type ToolName,
} from "./tools";

/**
 * One turn of the agent: the bounding rules and the grounding check, wired
 * together.
 *
 * The shape of a turn is deliberate:
 *   1. the user's words are recorded verbatim,
 *   2. consent is classified deterministically, before any model runs,
 *   3. the model chooses a reply and at most one tool,
 *   4. the tool handler decides whether that choice is allowed,
 *   5. the wording is checked against the facts before anyone sees it.
 *
 * Steps 2, 4 and 5 do not involve the model, which is why the model being wrong
 * is survivable.
 */

export type AgentTurnResult = {
  conversationId: string;
  /** So the client can drop a stale checkout handoff when the sale is closed. */
  state: Conversation["state"];
  reply: string;
  provider: LlmProvider;
  checkout: CheckoutHandoff | null;
  /**
   * A transaction the agent drafted and did not write.
   *
   * Handed back so the panel can show an editable card. It stays a suggestion
   * right up to the point somebody confirms it, and the confirm step re-reads
   * every field rather than trusting what comes back.
   */
  proposal: TransactionProposal | null;
  toolRequested: ToolName | "none" | "unknown";
  toolOutcome: "ran" | "refused" | "not_requested";
  grounding: "passed" | "fell_back_to_template" | "template_only";
};

type ModelChoice = {
  reply: string | null;
  tool: string | null;
  /** Fields for a drafted transaction, when the tool is proposeTransaction. */
  draft?: Record<string, unknown> | null;
};

function groundOrFallback(
  candidate: string | null,
  fallback: string,
  facts: UsageFacts,
): { text: string; grounding: AgentTurnResult["grounding"]; offending: string[] } {
  if (!candidate || !candidate.trim()) {
    return { text: fallback, grounding: "template_only", offending: [] };
  }

  const check = checkGrounding(candidate, facts);

  /**
   * Two questions, not one.
   *
   * Grounding asks whether a figure came from the data. Claims ask whether it
   * was used for the thing it describes — because a number can be genuine and
   * still be wrong in place. "3 of your charges repeat" passes the first check
   * whenever 3 appears anywhere in the facts, including as the number of
   * transactions left before the cap.
   */
  const claims = checkClaims(candidate, facts);

  if (check.ok && claims.ok) {
    return { text: candidate.trim(), grounding: "passed", offending: [] };
  }

  // Either a number the facts do not support, or one used to say something the
  // facts contradict. Discard the whole generation rather than repair it, and
  // name what was wrong so the trail says which of the two it was.
  return {
    text: fallback,
    grounding: "fell_back_to_template",
    offending: check.ok ? claims.wrong : check.offending,
  };
}

/** What the agent does when no model is reachable, or its answer was unusable. */
function deterministicTool(input: {
  message: string | null;
  intent: Intent | null;
  state: string;
  facts: UsageFacts;
  explain: { kind: string; body: string } | null;
}): ToolName | "none" {
  /**
   * Opening the upgrade notification is what records the pitch.
   *
   * This used to happen on the unprompted opening turn, and removing that turn
   * without moving this would have quietly broken consent: `explainSuggestion`
   * is the only thing that writes the suggestion row, and a yes is only
   * honoured when it postdates one. The chain is unchanged — an explanation
   * still comes before the agreement — it now happens somewhere the person
   * chose to go rather than the moment they arrived.
   *
   * The other three kinds record nothing and request nothing. They are facts
   * about somebody's own account and there is nothing to consent to.
   */
  if (input.explain) {
    return input.explain.kind === "upgrade_available" &&
      (input.state === "open" || input.state === "pitched")
      ? "explainSuggestion"
      : "none";
  }

  if (input.message === null) return "none";

  if (input.intent === "affirmative" && input.state === "pitched") {
    return "createCheckoutOrder";
  }
  return "none";
}

export async function runAgentTurn(input: {
  user: User;
  message: string | null;
  /**
   * The notification the person opened, when that is why this turn is running.
   *
   * A third kind of turn rather than a synthetic user message. Feeding the model
   * words we wrote as though the person had typed them would put invented
   * quotes in the one column of the audit trail that promises to be verbatim,
   * and would run consent classification over our own sentence.
   */
  explain?: { kind: string; body: string } | null;
}): Promise<AgentTurnResult> {
  const { user, message } = input;
  const explain = input.explain ?? null;
  const conversation = await getOrCreateConversation(user.id);
  const facts = await computeUsageFacts(user);

  let intent: Intent | null = null;

  if (message !== null) {
    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "user_reply",
      explanation: message,
    });

    intent = classifyIntent(message);

    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "intent",
      explanation: INTENT_EXPLANATION[intent],
      meta: {
        intent,
        classifiedBy: "lib/agent/intent.ts",
        note: "Deterministic. The language model does not decide whether the user consented.",
      },
    });

    // Someone who declined earlier and now asks to upgrade anyway. The agent
    // stays stopped, but silence would be the wrong kind of stopped: the rule
    // is only credible if you can see it being applied, so this is refused out
    // loud and written to the trail like any other refusal.
    if (intent === "affirmative" && conversation.state === "declined") {
      const reply = reopenAfterDeclineTemplate();

      await logAgentEvent({
        userId: user.id,
        conversationId: conversation.id,
        type: "tool_refused",
        explanation:
          "The user declined this upgrade earlier, so the agent did not act on a later yes. The manual Billing page path is unaffected.",
        meta: {
          rule: "stopped_after_decline",
          tool: "createCheckoutOrder",
          enforcedIn: "lib/agent/run.ts",
        },
      });

      await logAgentEvent({
        userId: user.id,
        conversationId: conversation.id,
        type: "agent_reply",
        explanation: reply,
        meta: { provider: "template", reason: "declined_conversation" },
      });

      return {
        conversationId: conversation.id,
        state: "declined",
        reply,
        provider: "template",
        checkout: null,
    proposal: null,
        toolRequested: "createCheckoutOrder",
        toolOutcome: "refused",
        grounding: "template_only",
      };
    }

    /**
     * A no about a draft is not a no about the sale.
     *
     * Checked before the decline branch because declining is the one
     * irreversible thing a user can do here — the file that classifies intent
     * says exactly that, and then inferred it from a message about a different
     * subject. Rejecting a draft discards the card and says so; it must never
     * reach `setConversationState(..., "declined")`.
     */
    if (intent === "negative" && (await hasPendingDraft(conversation.id))) {
      const reply =
        "Dropped that draft — nothing was saved. Tell me the right amount and what it was for, and I will draft it again.";

      await logAgentEvent({
        userId: user.id,
        conversationId: conversation.id,
        type: "agent_reply",
        explanation: reply,
        meta: {
          provider: "template",
          reason: "draft_rejected",
          note: "A no while a draft was on screen rejects the draft. The plan is untouched and the conversation stays open.",
        },
      });

      return {
        conversationId: conversation.id,
        state: conversation.state,
        reply,
        provider: "template",
        checkout: null,
        proposal: null,
        toolRequested: "none",
        toolOutcome: "not_requested",
        grounding: "template_only",
      };
    }

    // A no ends it here. No model call, nothing to decide.
    if (intent === "negative") {
      await setConversationState(conversation.id, "declined");
      // ...and the offer goes off the bell with it. Leaving it lit would make
      // the notification channel into the nagging the decline rule exists to
      // prevent — the person would refuse in the chat and still be carrying an
      // unread pitch. Cap warnings survive: those are about their account.
      await dismissUpgradeNotifications(user.id).catch(() => {});
      const reply = declineTemplate();
      await logAgentEvent({
        userId: user.id,
        conversationId: conversation.id,
        type: "agent_reply",
        explanation: reply,
        meta: { provider: "template", reason: "user_declined" },
      });

      return {
        conversationId: conversation.id,
        state: "declined",
        reply,
        provider: "template",
        checkout: null,
    proposal: null,
        toolRequested: "none",
        toolOutcome: "not_requested",
        grounding: "template_only",
      };
    }
  }

  /**
   * Nothing honest to pitch: say so rather than manufacturing a reason.
   *
   * Only reachable by a malformed call now that the agent never opens a
   * conversation on its own. An explain turn is excluded deliberately — it has
   * a subject already, and answering "nothing to flag" to somebody who just
   * tapped a notification about their cap would be absurd.
   */
  if (message === null && !explain && !hasUpgradeCase(facts)) {
    const reply =
      user.plan === "pro"
        ? `You are on Pro, so there is no cap on your ${facts.monthLabel} transactions and recurring charges are detected automatically. Ask me anything about your spending.`
        : `Nothing to flag right now — you are within the Free plan's cap of ${facts.freeTxnCap} transactions for ${facts.monthLabel}. Ask me anything about your spending.`;

    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "agent_reply",
      explanation: reply,
      facts: facts as unknown as Record<string, unknown>,
      meta: { provider: "template", reason: "no_upgrade_case" },
    });

    return {
      conversationId: conversation.id,
      state: conversation.state,
      reply,
      provider: "template",
      checkout: null,
    proposal: null,
      toolRequested: "none",
      toolOutcome: "not_requested",
      grounding: "template_only",
    };
  }

  const events = await transcript(conversation.id);
  const llm = await callLLM(
    SYSTEM_PROMPT,
    buildUserPrompt({
      facts,
      events,
      message,
      intent,
      conversationState: conversation.state,
      explain,
    }),
  );

  const choice = llm ? parseJsonLoosely<ModelChoice>(llm.text) : null;
  const provider: LlmProvider = llm ? llm.provider : "template";

  let requested: ToolName | "none" | "unknown";
  if (choice && choice.tool && choice.tool !== "none") {
    requested = isToolName(choice.tool) ? choice.tool : "unknown";
  } else if (choice) {
    requested = "none";
  } else {
    requested = deterministicTool({
      message,
      intent,
      state: conversation.state,
      facts,
      explain,
    });
  }

  // Rule 1 — the toolset is closed. A name outside it is refused and audited
  // rather than quietly ignored.
  if (requested === "unknown") {
    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "tool_refused",
      explanation: `The model asked for a tool that does not exist ("${String(choice?.tool)}"). Only ${TOOL_NAMES.join(", ")} are callable.`,
      meta: { rule: "closed_toolset", requested: choice?.tool },
    });
  }

  const ctx: ToolContext = { user, conversation, facts };
  let checkout: CheckoutHandoff | null = null;
  let toolOutcome: AgentTurnResult["toolOutcome"] = "not_requested";
  let proposal: TransactionProposal | null = null;
  /**
   * The floor, chosen by subject first and then by account.
   *
   * The subject cases come first because they are the ones that were being
   * answered with something else entirely, and because none of them quotes the
   * price. That last part is not incidental: `explainedUpgrade` is decided by
   * whether a reply contains the price, so routing a hello or a weather
   * question through the account summary spent the single pitch the agent gets
   * on somebody who had not asked to buy anything.
   *
   * Everything unmatched still lands on `answerTemplate`, deliberately. It is
   * the reply an unclear turn has to produce for a following yes to be
   * accepted, and narrowing it would break the consent chain rather than the
   * wording.
   */
  const topic = classifyTopic(message, intent, facts);

  const fallbackAnswer = () => {
    /**
     * An explanation falls back to the thing being explained.
     *
     * It used to fall through to the account summary, which ends by offering
     * the upgrade — so tapping a notification about a repeating charge produced
     * a sales pitch about something else. That is the exact behaviour the bell
     * exists to remove, reintroduced one layer down.
     *
     * The body is a safe floor precisely because it has already been through
     * `checkGrounding` and `checkClaims` on the way out of the store. The
     * upgrade notice is the exception: `explainSuggestion` runs for that one and
     * replaces this with the suggestion wording, which is what records the pitch.
     */
    if (explain && explain.kind !== "upgrade_available") return explain.body;

    if (topic === "greeting") return greetingTemplate(facts);
    if (topic === "off_topic") return offTopicTemplate();

    // A paying account keeps its own wording for everything else: it has
    // nothing to be sold, and the ordinary template ends by selling.
    if (user.plan === "pro") return proAnswerTemplate(facts);

    if (topic === "identity") return identityTemplate(facts);
    if (topic === "out_of_range") return cannotAnswerTemplate(facts);
    if (conversation.state === "declined") return declinedAnswerTemplate(facts);
    return answerTemplate(facts);
  };

  let deterministicReply = fallbackAnswer();
  let eventType: "suggestion" | "agent_reply" = "agent_reply";
  let modelReply = choice?.reply ?? null;

  if (requested === "explainSuggestion") {
    const outcome = await runExplainSuggestion(ctx);
    if (outcome.status === "ran") {
      toolOutcome = "ran";
      eventType = "suggestion";
      deterministicReply = suggestionTemplate(facts);
    } else {
      toolOutcome = "refused";
      deterministicReply = fallbackAnswer();
      // The tool was refused because the model tried to pitch when it must not,
      // which means the wording it generated in the same breath IS that pitch.
      // Blocking the state change while still delivering the sentence would
      // enforce the rule on the bookkeeping and not on the user.
      modelReply = null;
    }
  } else if (requested === "proposeTransaction") {
    const outcome = await runProposeTransaction(ctx, choice?.draft ?? {});
    if (outcome.status === "ran") {
      toolOutcome = "ran";
      // The card carries the numbers; whatever the model wrote alongside is
      // still grounding-checked like any other sentence.
      proposal = outcome.proposal ?? null;
      // ...and when that check discards it, the floor has to describe the card
      // rather than the account. It fell back to the summary-and-pitch template,
      // so somebody who said "I spent 450 on lunch" got a draft for 450 sitting
      // underneath a paragraph about their transaction cap.
      if (proposal) deterministicReply = proposalTemplate(proposal);
    } else {
      toolOutcome = "refused";
      deterministicReply = outcome.message;
      modelReply = null;
    }
  } else if (requested === "createCheckoutOrder") {
    const outcome = await runCreateCheckoutOrder(ctx);
    if (outcome.status === "ran") {
      toolOutcome = "ran";
      checkout = outcome.checkout ?? null;
      // The handoff wording is fixed, not model-authored: it is the sentence
      // that tells the user the agent cannot pay on their behalf.
      deterministicReply = outcome.reply ?? deterministicReply;
      modelReply = null;
    } else {
      toolOutcome = "refused";
      deterministicReply =
        outcome.rule === "no_recorded_consent"
          ? // The old wording asked a question it could not accept the answer
            // to. `explainedUpgrade` is decided by whether a reply quotes the
            // price, and this sentence did not, so the conversation never
            // reached "pitched" and the next yes was refused with the same
            // sentence — forever. It was masked only because the agent used to
            // open every conversation with a pitch of its own. Quoting the
            // price makes the sentence self-consistent: it asks for a yes to a
            // thing whose cost it states, which is the only kind this accepts.
            `I do not have a clear yes on record yet, so I have not created anything. Pro is a one-time ${formatPaise(facts.proPricePaise)} unlock — say yes and I will prepare the checkout for you to authorise.`
          : outcome.message;
      modelReply = null;
    }
  }

  /**
   * Wording is vetted, not merely grounded, whenever there is nothing left to
   * sell — after a decline, and equally for an account that already pays.
   *
   * Grounding catches invented numbers, not renewed persuasion: the price is
   * legitimately in the facts, so a re-pitch passes it cleanly. The only thing
   * stopping the model pitching a paying customer was a line in the system
   * prompt, which PLAN §6.6 is explicit is a request rather than a bound.
   */
  if (
    conversation.state === "declined" ||
    conversation.state === "converted" ||
    user.plan === "pro"
  ) {
    modelReply = null;
  }

  /**
   * A reply that describes Pro has to say what Pro costs.
   *
   * Asked what Pro includes, the model would list all five features and
   * never mention the price — an answer that reads complete and leaves out
   * the one number the person needs in order to decide. The deterministic
   * template has always named it; only the generated wording could drop it.
   *
   * So the price is treated as part of what makes a description of Pro
   * honest, and a reply that sells without pricing falls back to the
   * template rather than being repaired. Same rule as everywhere else here:
   * the model chooses the words, not which facts survive.
   */
  const price = formatPaise(facts.proPricePaise);

  /**
   * An explanation of anything other than the offer may not quote the price.
   *
   * The person tapped a fact about their own account. A model that answers it
   * by naming what Pro costs has turned an explanation into a pitch, and — worse
   * — quoting the price is what marks the upgrade as explained, so a curiosity
   * click would leave a later yes purchasable. Mechanical, and visible to a
   * mutation: delete this and the check below stops discarding anything.
   */
  if (explain && explain.kind !== "upgrade_available" && modelReply?.includes(price)) {
    modelReply = null;
  }
  const mustQuotePrice =
    user.plan === "free" && conversation.state !== "declined";

  if (
    mustQuotePrice &&
    modelReply &&
    /\bpro\b/i.test(modelReply) &&
    !modelReply.includes(price)
  ) {
    modelReply = null;
  }

  const grounded = groundOrFallback(modelReply, deterministicReply, facts);

  /**
   * Did this reply actually explain the upgrade?
   *
   * The pitch is not the only way the agent explains Pro. Asked "what does Pro
   * include?", it answers with the price, the features, and "tell me yes if you
   * want me to prepare the checkout" — an explanation and an invitation, just
   * not a pitch. Only the pitch marked the conversation as pitched, so the yes
   * that answer asked for mapped to no tool at all and was refused with "I do
   * not have a clear yes on record yet". The agent asked a question it could
   * not accept the answer to, and asking again did the same thing forever.
   *
   * Quoting the price is the test: it is the thing a yes commits to, and the
   * opening line on a healthy account ("nothing to flag right now") does not
   * quote it and deliberately does not qualify.
   */
  const explainedUpgrade =
    eventType === "suggestion" ||
    (user.plan === "free" &&
      conversation.state !== "declined" &&
      grounded.text.includes(formatPaise(facts.proPricePaise)));

  await logAgentEvent({
    userId: user.id,
    conversationId: conversation.id,
    type: eventType,
    explanation: grounded.text,
    facts: facts as unknown as Record<string, unknown>,
    meta: {
      provider,
      toolRequested: requested,
      toolOutcome,
      grounding: grounded.grounding,
      explainedUpgrade,
      ...(grounded.offending.length
        ? { ungroundedNumbers: grounded.offending }
        : {}),
    },
  });

  // Having explained the upgrade, the conversation is past the point where a
  // yes would be premature — so record that, or the next yes has no tool to
  // reach for.
  const nextState =
    explainedUpgrade && conversation.state === "open"
      ? "pitched"
      : conversation.state;

  if (nextState !== conversation.state) {
    await setConversationState(conversation.id, nextState);
  }

  return {
    conversationId: conversation.id,
    state: nextState,
    reply: grounded.text,
    provider,
    checkout,
    proposal,
    toolRequested: requested,
    toolOutcome,
    grounding: grounded.grounding,
  };
}
