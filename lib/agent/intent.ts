/**
 * Consent classification — PLAN.md §6.6, rule 2.
 *
 * Consent is decided here, deterministically, before the model is called. The
 * LLM is never the thing that decides the user said yes, because a model that
 * can be talked into believing consent is a model that can be talked into
 * taking a money action.
 *
 * The classifier is deliberately conservative in one direction: anything it
 * cannot read as a clear yes is not a yes. A false "unclear" costs one extra
 * turn of conversation; a false "affirmative" would charge someone who did not
 * agree to be charged.
 */

export type Intent = "affirmative" | "negative" | "question" | "unclear";

const NEGATIVE = [
  /\bno\b/,
  /\bnope\b/,
  /\bnah\b/,
  /\bnot now\b/,
  /\bnot interested\b/,
  /\bmaybe later\b/,
  /\blater\b/,
  /\bdon'?t\b/,
  /\bdo not\b/,
  /\bcancel\b/,
  /\bskip\b/,
  /\bstop\b/,
  /\bnever\b/,
];

const AFFIRMATIVE = [
  /\byes\b/,
  /\byeah\b/,
  /\byep\b/,
  /\byup\b/,
  /\bsure\b/,
  /\bok(?:ay)?\b/,
  /\bgo ahead\b/,
  /\bdo it\b/,
  /\bset it up\b/,
  /\bsounds good\b/,
  /\bproceed\b/,
  /\bupgrade me\b/,
  /\blet'?s do it\b/,
  /\bi'?m in\b/,
  /\bplease do\b/,
];

const QUESTION_WORDS = [
  /\bhow\b/,
  /\bwhat\b/,
  /\bwhy\b/,
  /\bwhich\b/,
  /\bwhen\b/,
  /\bcan i\b/,
  /\bdo i\b/,
  /\bis it\b/,
  /\bexplain\b/,
  /\btell me\b/,
];

export function classifyIntent(message: string): Intent {
  const text = message.toLowerCase().trim();
  if (!text) return "unclear";

  // Negatives are checked first so "no thanks, but how much is it?" stops at no.
  if (NEGATIVE.some((re) => re.test(text))) return "negative";

  const asksSomething = text.includes("?") || QUESTION_WORDS.some((re) => re.test(text));

  // A yes attached to a question ("yes, but what do I lose?") is treated as a
  // question, not consent. The user gets an answer and another chance to agree.
  if (AFFIRMATIVE.some((re) => re.test(text)) && !asksSomething) {
    return "affirmative";
  }

  if (asksSomething) return "question";

  return "unclear";
}

export const INTENT_EXPLANATION: Record<Intent, string> = {
  affirmative: "Read the reply as an explicit yes. This is the only state in which the checkout tool may run.",
  negative: "Read the reply as a no. The conversation is closed and the agent will not pitch again.",
  question: "Read the reply as a question. The agent may answer, but may not create a checkout.",
  unclear: "Could not read a clear yes or no. Treated as not consenting.",
};
