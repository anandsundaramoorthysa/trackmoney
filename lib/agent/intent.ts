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

export type Intent =
  | "affirmative"
  | "negative"
  | "question"
  | "unclear"
  | "greeting";

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
  // "who" and "where" were missing, so "who are you" — the first thing anyone
  // types at something with a name — was not classified as a question at all.
  // It fell through to unclear and was answered with a spending summary.
  /\bwho\b/,
  /\bwhere\b/,
  /\bcan i\b/,
  /\bdo i\b/,
  /\bis it\b/,
  /\bexplain\b/,
  /\btell me\b/,
];

/**
 * A message that is only a greeting.
 *
 * Anchored end to end on purpose: "hi" is a greeting, "hi, what did I spend on
 * food" is a question with a greeting stuck to the front, and answering the
 * second one with an introduction would be worse than useless.
 *
 * This exists because "hi" used to fall through to unclear, which answered with
 * the full account summary — and that summary quotes the price, which is what
 * marks the upgrade as having been explained. Saying hello counted as having
 * been pitched, and the pitch itself was then spent on somebody who had not
 * asked for it.
 */
const GREETING =
  /^(?:hi|hii+|hey|hello|helo|yo|namaste|hola|good\s+(?:morning|afternoon|evening)|greetings)\b[\s!.,]*(?:there|tracky(?:\s+ai)?)?[\s!.,?]*$/;

/**
 * "ok" on its own, meaning "I read that" and not "charge me".
 *
 * A bare "ok" is in the affirmative list and belongs there — "ok why not" and
 * "ok, do it" are consent. But the same token ends an acknowledgement, and
 * "ok thanks" was creating a ₹499 order. In Indian English, as in most
 * English, an unaccompanied "ok" closes a sentence rather than authorising
 * one, and the closing is by far the more common reading.
 *
 * So the affirmative rule stands and this narrow shape is carved out of it:
 * the whole message is "ok", optionally followed by a word that only ever ends
 * a conversation. Anything with an instruction in it is untouched.
 *
 * This is the same collision the file already fixed for "I'm not sure"
 * containing "sure" — a consent token sitting inside a phrase that is not
 * consent — and the asymmetry it argues from applies unchanged: a yes that
 * goes unrecognised costs one turn, a yes that was never given costs money.
 */
const ACKNOWLEDGEMENT_ONLY =
  /^(?:ok(?:ay)?|k|kk)\b[\s!.,]*(?:thanks|thank you|thanks a lot|ty|got it|noted|cool|fine|great|nice|sure thing|understood)?[\s!.,]*$/;

/**
 * A yes with a condition attached to it.
 *
 * "yes if it is free" is not agreement to pay ₹499; it is agreement to a
 * different offer that was never made. The affirmative list matched the "yes"
 * and stopped reading, so a person setting a condition was recorded as having
 * accepted the one on the table.
 *
 * Anything conditional resolves to unclear, which costs a turn of conversation
 * and asks them to say plainly what they meant. The alternative is charging
 * somebody for a thing they agreed to only hypothetically.
 */
const CONDITIONAL =
  /\b(if|unless|provided|assuming|as long as|so long as|only if|depending on|in case)\b/;

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

  // Before anything else, and before the refusal test: "no" is not in any
  // greeting, but "good evening" would otherwise be read for its words rather
  // than as the whole message it is.
  if (GREETING.test(text)) return "greeting";

  // Checked on the raw message, before the rhetorical phrases are stripped:
  // "ok why not" must keep its "why not", or it collapses to a bare "ok" and
  // reads as the acknowledgement it is not.
  if (ACKNOWLEDGEMENT_ONLY.test(text)) return "unclear";

  const meaningful = text.replace(NOT_A_REFUSAL, " ");

  // Asked of what remains once the rhetorical phrases are gone. A question
  // mark still counts wherever it appears, so a bare "why not?" — someone
  // genuinely asking for reasons — stays a question and gets an answer.
  const asksSomething =
    meaningful.includes("?") || QUESTION_WORDS.some((re) => re.test(meaningful));
  const saysNo = HARD_NEGATIVE.some((re) => re.test(meaningful));
  const mentionsNot = SOFT_NEGATIVE.some((re) => re.test(meaningful));
  const saysYes = AFFIRMATIVE.some((re) => re.test(meaningful));

  // A yes with a condition on it is not a yes to what was offered. Checked
  // before the affirmative test, because that test stops at the first match.
  if (saysYes && CONDITIONAL.test(meaningful)) return "unclear";

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
  greeting: "Read the reply as a greeting and nothing more. No consent, and no pitch is spent on it.",
};
