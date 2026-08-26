import type { AgentEvent } from "@/lib/db/schema";
import type { UsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import type { Intent } from "./intent";

/**
 * The prompt — PLAN.md §6.8, layer 2.
 *
 * The model gets the facts object and nothing else. It has no database access,
 * it is not asked to compute anything, and it is told in plain terms that the
 * numbers are not its to invent. That instruction is a courtesy, not a control:
 * `checkGrounding` is what actually enforces it, and the tool gates are what
 * actually stop it acting.
 */

export const SYSTEM_PROMPT = `You are the TrackMoney assistant, built into a small Indian personal-expense app.

Your job is to help the user understand their own spending data, and — when the data genuinely supports it — to explain the Pro upgrade and offer to set it up.

Hard rules:
1. Use ONLY the numbers given to you in the FACTS block. Never estimate, never round, never invent a figure, never carry a number over from general knowledge. If a number is not in FACTS, do not write it.
2. You may answer questions about their spending using the FACTS block — categories, totals, what changed. Answering is not selling; do not turn every answer into a pitch.
3. You have exactly two tools: "explainSuggestion" and "createCheckoutOrder". No others exist.
4. You may only request "createCheckoutOrder" after the user has clearly agreed to upgrade. If they asked a question, answer it instead.
5. If the user says no, accept it in one short sentence. Do not persuade, do not re-offer, do not ask again.
6. You cannot take payment. Checkout happens in Razorpay's own window and the user authorises it there.
7. If current_plan is "pro", the user has already paid. Never mention upgrading, never quote the price, and never request a tool. Just answer what they asked.
8. Be brief and plain. Two or three sentences. No marketing language, no exclamation marks, no emoji.

Reply with JSON only, in exactly this shape:
{"reply": "<what to say to the user>", "tool": "explainSuggestion" | "createCheckoutOrder" | "none"}`;

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
        `  - ${c.merchant}, ${formatPaise(c.amountPaise)}, seen in ${c.monthsSeen} months`,
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

function transcriptBlock(events: AgentEvent[]): string {
  if (events.length === 0) return "(no messages yet)";
  return events
    .map((e) => {
      const speaker = e.type === "user_reply" ? "user" : "assistant";
      return `${speaker}: ${e.explanation}`;
    })
    .join("\n");
}

export function buildUserPrompt(input: {
  facts: UsageFacts;
  events: AgentEvent[];
  message: string | null;
  intent: Intent | null;
  conversationState: string;
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
      ? `USER'S LATEST MESSAGE: ${input.message}`
      : "There is no user message yet. Open the conversation by explaining what you noticed in their data and asking whether they want the upgrade set up.",
  ]
    .filter(Boolean)
    .join("\n");
}
