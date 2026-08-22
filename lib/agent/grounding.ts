import type { UsageFacts } from "@/lib/facts";
import { formatPaise, paiseToRupeeNumber } from "@/lib/money";

/**
 * The grounding check — PLAN.md §6.8, layer 3.
 *
 * The model is handed a facts object and told to phrase it. This function then
 * checks that every number in what it produced actually came from that object.
 * If a figure appears that the facts do not support, the generation is thrown
 * away and a deterministic template is used instead.
 *
 * The effect is narrow but real: a fabricated number cannot reach the user, and
 * cannot reach the audit trail. The agent's sentences are the model's; its
 * numbers never are.
 */

function normalise(token: string): string {
  const cleaned = token.replace(/,/g, "");
  const asNumber = Number(cleaned);
  return Number.isFinite(asNumber) ? String(asNumber) : cleaned;
}

export function allowedNumberStrings(facts: UsageFacts): Set<string> {
  const values: number[] = [
    facts.txnCountThisMonth,
    facts.freeTxnCap,
    facts.overCapBy,
    facts.recurringCount,
    facts.proPricePaise,
    paiseToRupeeNumber(facts.proPricePaise),
    facts.recurringMonthlyTotalPaise,
    paiseToRupeeNumber(facts.recurringMonthlyTotalPaise),
    facts.proFeatures.length,
    facts.freeFeatures.length,
    facts.proOnlyFeatures.length,
    // Ordinals and small counts the model uses for list phrasing.
    0,
    1,
    2,
    3,
  ];

  for (const candidate of facts.recurringCandidates) {
    values.push(candidate.amountPaise);
    values.push(paiseToRupeeNumber(candidate.amountPaise));
    values.push(candidate.monthsSeen);
  }

  // The month label carries a year, e.g. "August 2026".
  const yearMatch = facts.monthLabel.match(/\d{4}/);
  if (yearMatch) values.push(Number(yearMatch[0]));

  return new Set(values.map((v) => normalise(String(v))));
}

export type GroundingResult = {
  ok: boolean;
  offending: string[];
};

export function checkGrounding(
  text: string,
  facts: UsageFacts,
): GroundingResult {
  const allowed = allowedNumberStrings(facts);
  const tokens = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const offending = [
    ...new Set(tokens.filter((token) => !allowed.has(normalise(token)))),
  ];

  return { ok: offending.length === 0, offending };
}

/* ------------------------------------------------------------------ */
/* Deterministic templates — the floor the agent can never fall below. */
/* ------------------------------------------------------------------ */

function listRecurring(facts: UsageFacts): string {
  return facts.recurringCandidates
    .map((c) => `${c.merchant} (${formatPaise(c.amountPaise)})`)
    .join(", ");
}

export function suggestionTemplate(facts: UsageFacts): string {
  const parts: string[] = [];

  if (facts.isOverCap) {
    parts.push(
      `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, which is ${facts.overCapBy} over the Free plan's cap of ${facts.freeTxnCap}.`,
    );
  } else {
    parts.push(
      `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against the Free plan's cap of ${facts.freeTxnCap}.`,
    );
  }

  if (facts.recurringCount > 0) {
    parts.push(
      `I also see ${facts.recurringCount} charges that repeat at the same amount every month — ${listRecurring(facts)} — and Free does not detect those automatically.`,
    );
  }

  parts.push(
    `Pro is a one-time ${formatPaise(facts.proPricePaise)} unlock and adds: ${facts.proOnlyFeatures.join("; ")}.`,
  );
  parts.push("Would you like me to set that up?");

  return parts.join(" ");
}

export function answerTemplate(facts: UsageFacts): string {
  return [
    `Here is what I can tell you from your account: ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against a Free cap of ${facts.freeTxnCap}.`,
    facts.recurringCount > 0
      ? `${facts.recurringCount} of your charges repeat monthly (${listRecurring(facts)}).`
      : "",
    `Pro costs ${formatPaise(facts.proPricePaise)} as a one-time unlock and adds: ${facts.proOnlyFeatures.join("; ")}.`,
    "Tell me yes if you want me to prepare the checkout, or no and I will leave it.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What the agent says to someone who is already paying.
 *
 * A Pro account has nothing to be sold, so the ordinary answer template — which
 * ends by offering the upgrade — would be both useless and faintly insulting to
 * a customer who already bought it.
 */
export function proAnswerTemplate(facts: UsageFacts): string {
  return [
    `You are on Pro, so there is no cap on transactions — you have logged ${facts.txnCountThisMonth} in ${facts.monthLabel}.`,
    facts.recurringCount > 0
      ? `I am tracking ${facts.recurringCount} recurring charges for you: ${listRecurring(facts)}.`
      : "I am not seeing any recurring charges yet.",
    "Ask me anything about your spending.",
  ].join(" ");
}

/**
 * For someone who declined and later asks to upgrade anyway.
 *
 * The agent stays stopped — that is the whole point of the decline rule — but
 * it says so plainly and points at the path that does not involve it, rather
 * than going quiet and leaving the person stuck.
 */
export function reopenAfterDeclineTemplate(): string {
  return "You told me earlier that you did not want this, so I am not going to set it up from here. If you have changed your mind, the Billing page has an Upgrade to Pro button that works without me.";
}

export function declineTemplate(): string {
  return "Understood — I will leave your plan as it is and I will not bring this up again in this session. Everything on Free keeps working; you can always upgrade yourself from the Billing page.";
}

export function checkoutReadyTemplate(amountPaise: number): string {
  return `Your ${formatPaise(amountPaise)} test-mode order is ready. I cannot complete a payment myself — use the button below to open Razorpay's checkout and authorise it there.`;
}
