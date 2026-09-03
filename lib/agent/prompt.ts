import { CATEGORIES } from "@/lib/categories";
import type { AgentEvent } from "@/lib/db/schema";
import type { UsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { neutraliseUserText } from "./grounding";
import type { Intent } from "./intent";

/** Line break, named so the nested prompt block below stays readable. */
const NEWLINE = "\n";

/**
 * The prompt, layer 2.
 *
 * The model gets the facts object and nothing else. It has no database access,
 * it is not asked to compute anything, and it is told in plain terms that the
 * numbers are not its to invent. That instruction is a courtesy, not a control:
 * `checkGrounding` is what actually enforces it, and the tool gates are what
 * actually stop it acting.
 */

/**
 * The name lives in three places and this is the weakest of them.
 *
 * A prompt is a request, not a bound — the whole file above says so — and the
 * template tier has no model in it at all, so a persona that existed only here
 * would vanish in exactly the two situations where it matters most: a model
 * that drifts, and both providers being down. The panel header renders the name
 * and the deterministic templates speak it, so the identity survives a total
 * outage. Rule 11 only governs how the model refers to something the app has
 * already established.
 *
 * Rules 9 to 11 exist because the prompt had nothing to say about the three
 * things users type first. "What did I spend in March" fell through to a
 * template that confidently answered about September; "what's the weather" was
 * answerable from general knowledge, and grounding never looks at a sentence
 * with no digits in it; "who are you" was not classified as a question at all.
 *
 * Rule 12 replaces a flat "two or three sentences" that the code itself did not
 * keep — `answerTemplate` is five clauses and `suggestionTemplate` four — so
 * the model was held to a length its own fallback ignored, and the register
 * visibly changed whenever grounding fell back mid-conversation.
 */
export const SYSTEM_PROMPT = `You are Tracky AI, the assistant inside TrackMoney — a small Indian personal-expense app. You read one account's spending for the month on screen, you draft transactions the user confirms themselves, and you explain the Pro upgrade when the data supports it. Amounts are Indian rupees, written exactly as the FACTS block writes them.

Hard rules:
1. Use ONLY the numbers given to you in the FACTS block. Never estimate, never round, never invent a figure, never carry a number over from general knowledge. If a number is not in FACTS, do not write it.
2. You may answer questions about their spending using the FACTS block — categories, totals, what changed. Answering is not selling; do not turn every answer into a pitch.
3. You have exactly three tools: "explainSuggestion", "createCheckoutOrder" and "proposeTransaction". No others exist.
4. You may only request "createCheckoutOrder" after the user has clearly agreed to upgrade. If they asked a question, answer it instead.
5. When the user describes something they spent, request "proposeTransaction" and fill "draft" with what they said. You are drafting, not saving: the user sees the draft and confirms it themselves. Never claim it is saved.
6. If the user says no, accept it in one short sentence. Do not persuade, do not re-offer, do not ask again.
7. You cannot take payment. Checkout happens in Razorpay's own window and the user authorises it there.
8. If current_plan is "pro", the user has already paid. Never mention upgrading and never quote the price. You may still draft a transaction for them.
9. If FACTS does not contain what was asked, say so in one sentence and name what you can see instead. Do not guess, do not approximate, and do not answer a different question.
10. You only discuss this account's spending. Anything else — weather, news, general advice, other apps, yourself as a general assistant — gets one sentence saying it is outside what you do. Do not answer from general knowledge; you have none the user should trust.
11. Asked what you are: you are Tracky AI, you read this account's spending, you draft transactions for the user to confirm, and you cannot take a payment. Say it once, plainly, and stop. Never refer to yourself in the third person and never open a message with your own name.
12. Say it in as few sentences as the answer needs and no more. One number is one sentence. Never more than four. No marketing language, no exclamation marks, no emoji.

CATEGORIES (the "category" field must be exactly one of these):
${CATEGORIES.join(", ")}

Reply with JSON only, in exactly this shape:
{"reply": "<what to say to the user>", "tool": "explainSuggestion" | "createCheckoutOrder" | "proposeTransaction" | "none", "draft": {"merchant": "<who>", "amount": "<rupees>", "category": "<one of the CATEGORIES above>", "occurredOn": "YYYY-MM-DD"} | null}`;

function factsBlock(facts: UsageFacts): string {
  const lines = [
    `current_plan: ${facts.currentPlan}`,
    `month: ${facts.monthLabel}`,
    `transactions_this_month: ${facts.txnCountThisMonth}`,
    `free_plan_transaction_cap: ${facts.freeTxnCap}`,
    `transactions_left_on_free: ${facts.remainingOnFree}`,
    `free_plan_will_refuse_the_next_one: ${facts.atCap}`,
    `pro_price: ${formatPaise(facts.proPricePaise)} (one-time)`,
    `recurring_charges_detected: ${facts.recurringCount}`,
  ];

  // Only a Pro account is told which charges recur. Handing the model the list
  // for a Free account would let it give away, in the pitch, the very thing the
  // pitch is selling.
  if (facts.showsRecurringDetail) {
    for (const c of facts.recurringCandidates) {
      lines.push(
        `  - ${neutraliseUserText(c.merchant)}, ${formatPaise(c.amountPaise)}, seen in ${c.monthsSeen} months`,
      );
    }
  } else if (facts.recurringCount > 0) {
    lines.push(
      "  (Free shows only the count. Do not name the merchants or their amounts.)",
    );
  }

  lines.push(`spent_this_month: ${formatPaise(facts.totalSpentPaise)}`);
  lines.push(`spent_last_month: ${formatPaise(facts.previousTotalSpentPaise)}`);

  if (facts.categories.length > 0) {
    lines.push("spending_by_category:");
    for (const row of facts.categories) {
      const direction = row.changePaise >= 0 ? "up" : "down";
      lines.push(
        `  - ${row.category}: ${formatPaise(row.totalPaise)} (${direction} ${formatPaise(Math.abs(row.changePaise))} on last month)`,
      );
    }
    if (facts.currentPlan === "free") {
      lines.push("  (Free sees only its largest categories. Do not imply this is the full list.)");
    }
  }

  lines.push(`pro_adds: ${facts.proOnlyFeatures.join("; ")}`);
  return lines.join("\n");
}

/**
 * The transcript, neutralised the same way merchant names are.
 *
 * Merchant text was treated as the injection vector and the chat box was not,
 * which had it backwards: the chat box is where a person types directly at the
 * model, and the transcript then re-serves every past attempt on every
 * subsequent turn. The tool gates hold either way — that is what makes this
 * low severity rather than a hole — but a defence applied to the indirect route
 * and not the direct one is an inconsistency waiting to be pointed at.
 */
function transcriptBlock(events: AgentEvent[]): string {
  if (events.length === 0) return "(no messages yet)";
  return events
    .map((e) => {
      const speaker = e.type === "user_reply" ? "user" : "assistant";
      return `${speaker}: ${neutraliseUserText(e.explanation)}`;
    })
    .join("\n");
}

export function buildUserPrompt(input: {
  facts: UsageFacts;
  events: AgentEvent[];
  message: string | null;
  intent: Intent | null;
  conversationState: string;
  /** Set when the person opened a notification rather than typing. */
  explain?: { kind: string; body: string } | null;
}): string {
  return [
    "FACTS (the only numbers you may use):",
    factsBlock(input.facts),
    "",
    "CONVERSATION SO FAR:",
    transcriptBlock(input.events),
    "",
    `CONVERSATION STATE: ${input.conversationState}`,
    input.intent
      ? `THE SYSTEM CLASSIFIED THE USER'S LAST MESSAGE AS: ${input.intent}`
      : "",
    "",
    input.message
      ? `USER'S LATEST MESSAGE: ${neutraliseUserText(input.message)}`
      : input.explain
        ? [
            "EXPLAINING A NOTIFICATION — the person tapped this, they did not type.",
            `kind: ${input.explain.kind}`,
            `shown to them as: "${neutraliseUserText(input.explain.body)}"`,
            "",
            "Explain that one thing in more depth, using only the numbers in FACTS.",
            "Say what it means for them and what happens next. Do not raise anything",
            "else and do not open a second subject.",
          ].join(NEWLINE)
        : // The honest floor for a turn with nothing in it. The agent used to
          // open here with an unprompted pitch; there is no longer any such
          // thing as a turn the agent starts, so this is only reachable by a
          // malformed call and it must not invent a reason to speak.
          "There is no user message and nothing to explain. Say in one sentence that you can answer questions about their spending, and stop.",
  ]
    .filter(Boolean)
    .join("\n");
}
