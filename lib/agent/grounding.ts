import type { UsageFacts } from "@/lib/facts";
import { formatPaise, paiseToRupeeNumber } from "@/lib/money";

/**
 * The grounding check, layer 3.
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
  // Rupee figures only, never the paise originals.
  //
  // The model is handed formatted rupees and never sees paise, so no honest
  // generation contains 49900. Allowing it because the same quantity exists in
  // the facts under a different unit was the difference between checking "this
  // figure is supported" and checking "this integer appears somewhere" — and it
  // let "₹49,900" be reported as grounded against a ₹499 order.
  const values: number[] = [
    facts.txnCountThisMonth,
    facts.freeTxnCap,
    facts.remainingOnFree,
    facts.recurringCount,
    paiseToRupeeNumber(facts.proPricePaise),
    paiseToRupeeNumber(facts.recurringMonthlyTotalPaise),
    paiseToRupeeNumber(facts.totalSpentPaise),
    paiseToRupeeNumber(facts.previousTotalSpentPaise),
    facts.proFeatures.length,
    facts.freeFeatures.length,
    facts.proOnlyFeatures.length,
  ];

  // Note what is deliberately NOT here: a blanket allowance for small numbers.
  // Waving through 0-3 for "list phrasing" also waved through every wrong small
  // count — "2 of your charges repeat" passed the check while the facts said 3.
  // A count is exactly the kind of figure this is supposed to police.

  for (const row of facts.categories) {
    values.push(paiseToRupeeNumber(row.totalPaise));
    values.push(paiseToRupeeNumber(Math.abs(row.changePaise)));
  }

  for (const candidate of facts.recurringCandidates) {
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

/**
 * Claims: the number is right, and it is being used for the right thing.
 *
 * `checkGrounding` answers "did this figure come from the data", which is a
 * real question and not the only one. Its stated blind spot was that a figure
 * can be genuine and still be wrong in place: 3 sits in the facts as
 * "transactions left before the cap", so a sentence claiming three charges
 * recur passes cleanly while saying something false.
 *
 * This closes that for the claims the agent actually makes. Each pattern binds
 * a phrasing to the one fact that is allowed to fill it, so a number in the
 * wrong role is caught even though it appears somewhere in the data.
 *
 * It is deliberately a small list. A general "is this sentence true" checker is
 * not a thing anyone can write, and pretending otherwise would be worse than
 * the narrow check this replaces — so the patterns cover the claims the
 * templates and the prompt actually produce, and everything else still falls
 * through to the numeric check.
 */
type Claim = {
  /** Captures the figure in group 1. */
  pattern: RegExp;
  /** What that figure is allowed to be. */
  expected: (facts: UsageFacts) => number;
  /** Named in the audit trail when it does not match. */
  describes: string;
};

const CLAIMS: Claim[] = [
  {
    pattern: /(\d[\d,]*)\s+of\s+your\s+charges\s+repeat/i,
    expected: (f) => f.recurringCount,
    describes: "how many charges recur",
  },
  {
    pattern: /(\d[\d,]*)\s+transactions?\s+in\b/i,
    expected: (f) => f.txnCountThisMonth,
    describes: "how many transactions this month",
  },
  {
    pattern: /cap\s+of\s+(\d[\d,]*)/i,
    expected: (f) => f.freeTxnCap,
    describes: "the Free cap",
  },
  {
    pattern: /with\s+(\d[\d,]*)\s+left/i,
    expected: (f) => f.remainingOnFree,
    describes: "how many are left on Free",
  },
  {
    pattern: /(?:costs|price|one-time unlock of)\s*₹\s*(\d[\d,]*)/i,
    expected: (f) => Math.round(f.proPricePaise / 100),
    describes: "the price of Pro",
  },
  {
    pattern: /₹\s*(\d[\d,]*(?:\.\d+)?)\s+(?:this month|in total)/i,
    expected: (f) => Math.round(f.totalSpentPaise / 100),
    describes: "what was spent this month",
  },
  {
    pattern: /(\d[\d,]*)\s+(?:more )?transactions?\s+(?:before|until)/i,
    expected: (f) => f.remainingOnFree,
    describes: "how many transactions remain",
  },
];

/**
 * Text that is trying to be an instruction rather than a merchant name.
 *
 * A transaction's merchant is the user's own data and it reaches the model's
 * prompt, which is the vector the AP2 red-teaming work goes after. The tool
 * gates make it useless for moving money — those run in code, and no wording
 * reaches them — but an injected string can still steer what the agent *says*,
 * and a confident false sentence is its own kind of harm.
 *
 * So merchant text is neutralised before it is interpolated. Not sanitised into
 * silence: a merchant genuinely called "Ignore Cafe" should still be readable.
 * The markers that make a line look like a new instruction are what goes.
 */
const INSTRUCTION_SHAPED =
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\b|\b(system|assistant|developer)\s*:|<\/?(system|instructions?)>|\bnew\s+instructions?\b/gi;

export function neutraliseUserText(value: string): string {
  return value
    .replace(INSTRUCTION_SHAPED, "[redacted]")
    // Line breaks are how a payload pretends to start a fresh turn.
    .replace(/[\r\n]+/g, " ")
    .slice(0, 80);
}

export type ClaimResult = {
  ok: boolean;
  /** One sentence per wrong claim, for the audit trail. */
  wrong: string[];
};

export function checkClaims(text: string, facts: UsageFacts): ClaimResult {
  const wrong: string[] = [];

  for (const claim of CLAIMS) {
    const found = text.match(claim.pattern);
    if (!found) continue;

    const said = Number(found[1].replace(/,/g, ""));
    const truth = claim.expected(facts);

    if (Number.isFinite(said) && said !== truth) {
      wrong.push(`said ${said} for ${claim.describes}, which is ${truth}`);
    }
  }

  return { ok: wrong.length === 0, wrong };
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

  if (facts.atCap) {
    parts.push(
      `You have used all ${facts.freeTxnCap} of your Free transactions for ${facts.monthLabel}, so the next one will not be saved.`,
    );
  } else if (facts.remainingOnFree <= 1) {
    parts.push(
      `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, leaving ${facts.remainingOnFree} before the Free plan's cap of ${facts.freeTxnCap}.`,
    );
  } else {
    parts.push(
      `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against the Free plan's cap of ${facts.freeTxnCap}.`,
    );
  }

  if (facts.recurringCount > 0) {
    parts.push(
      facts.showsRecurringDetail
        ? `I also see ${facts.recurringCount} charges that repeat at the same amount every month: ${listRecurring(facts)}.`
        : `I can also see that ${facts.recurringCount} of your charges repeat at the same amount every month, though Free only tells you how many — not which ones.`,
    );
  }

  parts.push(
    `Pro is a one-time ${formatPaise(facts.proPricePaise)} unlock and adds: ${facts.proOnlyFeatures.join("; ")}.`,
  );
  parts.push("Would you like me to set that up?");

  return parts.join(" ");
}

/** The biggest category, phrased as a fact rather than an opinion. */
function topCategoryLine(facts: UsageFacts): string {
  const top = facts.categories[0];
  if (!top) return "";
  return `Your largest category this month is ${top.category} at ${formatPaise(top.totalPaise)}.`;
}

export function answerTemplate(facts: UsageFacts): string {
  return [
    `Here is what I can tell you from your account: ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against a Free cap of ${facts.freeTxnCap}, with ${facts.remainingOnFree} left.`,
    facts.recurringCount > 0
      ? facts.showsRecurringDetail
        ? `${facts.recurringCount} of your charges repeat monthly: ${listRecurring(facts)}.`
        : `${facts.recurringCount} of your charges repeat monthly; Free shows the count but not which ones.`
      : "",
    topCategoryLine(facts),
    `Pro costs ${formatPaise(facts.proPricePaise)} as a one-time unlock and adds: ${facts.proOnlyFeatures.join("; ")}.`,
    "Tell me yes if you want me to prepare the checkout, or no and I will leave it.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Answering a question from someone who has already said no.
 *
 * The ordinary answer template ends by offering to prepare the checkout, which
 * in a declined conversation is exactly the nagging the decline rule exists to
 * prevent. The facts are still answered; the offer is not repeated.
 */
export function declinedAnswerTemplate(facts: UsageFacts): string {
  return [
    `You have logged ${facts.txnCountThisMonth} transactions in ${facts.monthLabel}, against a Free cap of ${facts.freeTxnCap}.`,
    facts.recurringCount > 0
      ? `${facts.recurringCount} of your charges repeat monthly.`
      : "",
    "You told me you did not want the upgrade, so I will leave it there. The Billing page has it if you ever want it.",
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
      ? `I am tracking ${facts.recurringCount} recurring ${
          facts.recurringCount === 1 ? "charge" : "charges"
        } for you: ${listRecurring(facts)}.`
      : "I am not seeing any recurring charges yet.",
    topCategoryLine(facts),
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
