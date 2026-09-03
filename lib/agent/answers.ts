import type { UsageFacts } from "@/lib/facts";
import type { Intent } from "./intent";

/**
 * What the deterministic tier says, by subject.
 *
 * The templates were written for one situation — a Free account being told
 * about its cap — and every other situation borrowed that text. So "hi" was
 * answered with a five-clause account summary ending in a sales question,
 * "who are you" got the same, and "what did I spend in March" got a confident
 * answer about September. The reply was always well-formed and often about
 * something the person had not asked.
 *
 * This picks the subject. It runs before any model call is considered and it
 * decides the floor the turn can never fall below, so the improvement survives
 * both providers being down — which is the tier the demo actually runs in.
 *
 * Everything here is a decision about *which* fixed sentence to use. No numbers
 * are computed and nothing is generated, so nothing here can be ungrounded.
 */
export type AnswerTopic =
  | "greeting"
  | "identity"
  | "off_topic"
  | "out_of_range"
  | "general";

/** "who are you", "what can you do", "are you a bot". */
const IDENTITY =
  /\b(who|what)\s+(are|r)\s+(you|u)\b|\bwhat\s+(can|do)\s+you\s+do\b|\bare\s+you\s+(a\s+)?(bot|human|ai|real|chatgpt|gpt)\b|\byour\s+name\b|\bwhat\s+is\s+tracky\b/;

/**
 * Subjects this app has nothing to say about.
 *
 * A closed list, and deliberately a short one. The risk here runs one way: a
 * false positive tells somebody their real question is off-topic, which is
 * worse than answering a stray question about the weather. So these have to be
 * unmistakable, and the guard below requires the message to carry no money
 * vocabulary at all before any of them counts.
 *
 * This is the one rule in the file with no code gate behind it, and it should
 * not pretend otherwise: `checkGrounding` only inspects digits, so "it is sunny
 * in Bangalore" passes every check this codebase has. A numbers check cannot
 * catch a sentence with no numbers in it. What makes that acceptable is that
 * the tool gates are real — an off-topic answer is embarrassing, not expensive.
 */
const OFF_TOPIC =
  /\b(weather|temperature|rain|forecast|news|headline|cricket|football|match score|movie|recipe|cook|joke|poem|translate|prime minister|president|capital of|who won|stock market|bitcoin|crypto price)\b/;

/**
 * Anything that means the question is about this account's money.
 *
 * Its only job is to stop the off-topic list from firing on a real question
 * that happens to contain one of those words — "how much did I spend on movie
 * tickets" is not a question about films.
 */
const ABOUT_MONEY =
  /\b(spend|spent|spending|paid|pay|cost|budget|transaction|txn|category|categories|recurring|subscription|charge|charges|total|month|cap|limit|plan|pro|free|upgrade|money|rupee|rupees|₹|account|expense|expenses|save|saved|bill|bills)\b/;

/**
 * A period the facts cannot reach.
 *
 * `UsageFacts` carries this month and the previous one and nothing else, so a
 * question naming any other month, or a year that is not the current one, has
 * no answer here. Detecting it explicitly is what lets the agent say "I cannot
 * see that" instead of answering about a month the user did not ask about.
 *
 * Matching is on names and years only — never on a relative phrase like "last
 * month", which IS in range — so the check errs towards answering.
 */
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const LONG_AGO = /\b(last year|previous year|this year|year to date|ytd|all time|since i (started|joined)|every month since)\b/;

function namesAnUnreachablePeriod(text: string, facts: UsageFacts): boolean {
  if (LONG_AGO.test(text)) return true;

  // The two months the facts cover, by name. Only the current one is labelled;
  // the previous one is the month before it, wrapping at January, and the facts
  // carry its total under `previousTotalSpentPaise`.
  const current = facts.monthLabel.toLowerCase().split(" ")[0];
  const currentIndex = MONTH_NAMES.indexOf(current);
  const inRange = new Set(
    currentIndex === -1
      ? [current]
      : [current, MONTH_NAMES[(currentIndex + 11) % 12]],
  );

  for (const month of MONTH_NAMES) {
    // Word-bounded so "may" as a modal verb ("may I ask") does not count as a
    // month unless it is the only reading available.
    if (new RegExp(`\\b${month}\\b`).test(text) && !inRange.has(month)) {
      return true;
    }
  }

  const yearMatch = facts.monthLabel.match(/\d{4}/);
  const thisYear = yearMatch ? yearMatch[0] : null;
  for (const year of text.match(/\b(19|20)\d{2}\b/g) ?? []) {
    if (year !== thisYear) return true;
  }

  return false;
}

export function classifyTopic(
  message: string | null,
  intent: Intent | null,
  facts: UsageFacts,
): AnswerTopic {
  if (intent === "greeting") return "greeting";
  if (!message) return "general";

  const text = message.toLowerCase();

  if (IDENTITY.test(text)) return "identity";

  // Money vocabulary wins over the off-topic list, always. "How much did I
  // spend on movie tickets" contains "movie" and is not a question about films.
  if (!ABOUT_MONEY.test(text) && OFF_TOPIC.test(text)) return "off_topic";

  if (namesAnUnreachablePeriod(text, facts)) return "out_of_range";

  return "general";
}
