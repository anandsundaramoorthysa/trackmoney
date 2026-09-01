/**
 * Consent classification, rule 2.
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

/**
 * An unambiguous refusal. These end the conversation even when a question is
 * attached, because "no thanks, but how much is it?" is still a no.
 */
const HARD_NEGATIVE = [
  /\bno\b/,
  /\bnope\b/,
  /\bnah\b/,
  /\bnot now\b/,
  /\bnot interested\b/,
  /\bno thanks\b/,
  /\bmaybe later\b/,
];

/**
 * Words that merely *mention* not-doing-something. On their own they read as a
 * refusal; inside a question they are usually the opposite — someone working
 * out what happens if they decline is still deciding.
 *
 * Treating these as refusals regardless of phrasing meant "what happens if I
 * don't upgrade?" permanently closed the conversation and recorded the person
 * as having declined something they had only asked about. Declining is the one
 * irreversible thing a user can do here, so it must never be inferred from a
 * question.
 */
const SOFT_NEGATIVE = [
  /\bnot\b/,
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

/**
 * Phrases that carry a refusal word without being a refusal.
 *
 * "no problem, go ahead" is a yes. Matching the bare token meant the most
 * enthusiastic possible consent was recorded as a permanent decline, which is
 * the one thing this classifier must never infer.
 *
 * "why not" belongs here for the same reason and one more: it is neither a
 * negation nor, despite the word, a question. "Sure, why not" is somebody
 * agreeing, and it was being read first as a contradiction and then as a
 * request for reasons — two turns of the agent explaining itself to a person
 * who had already said yes.
 *
 * These are removed before the refusal test runs, and before the question
 * test, so a rhetorical "why" does not make an answer into a question.
 */
const NOT_A_REFUSAL =
  /\b(no(t a|t an|t)? (problem|worries|worry|doubt|issue|issues|idea|rush|hurry|need|objection)|why not)\b/g;

export function classifyIntent(message: string): Intent {
  const text = message.toLowerCase().trim();
  if (!text) return "unclear";

  const meaningful = text.replace(NOT_A_REFUSAL, " ");

  // Asked of what remains once the rhetorical phrases are gone. A question
  // mark still counts wherever it appears, so a bare "why not?" — someone
  // genuinely asking for reasons — stays a question and gets an answer.
  const asksSomething =
    meaningful.includes("?") || QUESTION_WORDS.some((re) => re.test(meaningful));
  const saysNo = HARD_NEGATIVE.some((re) => re.test(meaningful));
  const mentionsNot = SOFT_NEGATIVE.some((re) => re.test(meaningful));
  const saysYes = AFFIRMATIVE.some((re) => re.test(meaningful));

  // A message carrying both a refusal and an agreement is not evidence of
  // either. Both outcomes here are costly — one charges someone, the other
  // closes the conversation for good — so a conflict resolves to neither.
  //
  // A softer negation counts here too. "I'm not sure" is the ordinary way to
  // express doubt, and it contains "sure": read as an agreement, it authorised
  // a ₹499 charge on the strength of somebody hesitating. It is not a
  // refusal either, so the answer is neither, and the person gets asked again.
  if ((saysNo || mentionsNot) && saysYes) return "unclear";

  // An outright no ends it, question attached or not.
  if (saysNo) return "negative";

  // A softer negation only counts as a refusal when it is not part of a
  // question. "I don't want it" is a no; "what if I don't?" is a question.
  if (mentionsNot && !asksSomething) return "negative";

  // A yes attached to a question ("yes, but what do I lose?") is treated as a
  // question, not consent. The user gets an answer and another chance to agree.
  if (saysYes && !asksSomething) return "affirmative";

  if (asksSomething) return "question";

  return "unclear";
}

export const INTENT_EXPLANATION: Record<Intent, string> = {
  affirmative: "Read the reply as an explicit yes. This is the only state in which the checkout tool may run.",
  negative: "Read the reply as a no. The conversation is closed and the agent will not pitch again.",
  question: "Read the reply as a question. The agent may answer, but may not create a checkout.",
  unclear: "Could not read a clear yes or no. Treated as not consenting.",
};
