import type { ToolName } from "./tools";

/**
 * The step loop, and what it is allowed to be.
 *
 * Until now a turn was one model call and at most one tool. That is easy to
 * reason about and it fails at one ordinary thing: when a draft comes back
 * unreadable, the turn ends with "I could not make a transaction out of that"
 * and the person has to start again, retyping something they already said
 * clearly enough for a human.
 *
 * So a turn may now take more than one step: propose, have the result judged in
 * code, and if it was refused, try again knowing why. Plan, act, observe. That
 * is the whole of it.
 *
 * ── What makes this safe is what it cannot do ──────────────────────────────
 *
 * A loop around an agent is the point where a careful system usually stops
 * being careful, because every gate now has to hold N times instead of once,
 * and the model gets N chances to find the one phrasing that slips through.
 * Two structural answers rather than two instructions:
 *
 * 1. ONLY DRAFTING ITERATES. `LOOPABLE` is a one-element set. A step loop
 *    cannot be entered for `createCheckoutOrder` or `explainSuggestion`, so no
 *    amount of iterating can reach a money action or spend the single pitch.
 *    Drafting is the safe one to repeat because a draft does nothing: it puts a
 *    card on screen that a person still has to confirm.
 *
 * 2. THE BUDGET IS SPENT, NOT CHECKED. Each attempt decrements a counter that
 *    the model never sees and cannot influence. There is no phrasing that earns
 *    another turn.
 *
 * The consent ledger is untouched by any of this. Consent is still classified
 * once, from the user's own words, before the first step runs.
 */

/**
 * Tools a turn may retry.
 *
 * Deliberately a set with one member rather than a boolean on each tool: adding
 * a second one has to be a decision somebody makes here, in a file that argues
 * about why, rather than a flag flipped in passing.
 */
export const LOOPABLE: ReadonlySet<ToolName> = new Set<ToolName>([
  "proposeTransaction",
]);

/**
 * How many attempts one turn gets, in total.
 *
 * Two, not five. The failure this exists for is a model that garbled a field it
 * had the information for, and that is fixed on the second try or not at all: a
 * model that cannot read "I spent 200 on coffee" with the refusal in front of
 * it will not read it on the fourth pass either. A larger budget would mostly
 * buy latency, and every extra attempt is another chance for the gates to be
 * probed.
 */
export const MAX_STEPS = 2;

export type StepRecord = {
  step: number;
  tool: ToolName | "none" | "unknown";
  outcome: "ran" | "refused";
  /** Why it was refused, when it was. */
  rule?: string;
};

/**
 * May this turn take another step?
 *
 * Everything here is decided from what already happened, never from anything
 * the model asked for. A step is granted only when the budget is unspent, the
 * tool is one that may iterate, and the last attempt was actually refused —
 * a successful draft ends the turn, because iterating after success would be
 * the agent deciding on its own to do more than it was asked.
 */
export function mayTakeAnotherStep(input: {
  stepsTaken: number;
  tool: ToolName | "none" | "unknown";
  lastOutcome: "ran" | "refused";
}): boolean {
  if (input.stepsTaken >= MAX_STEPS) return false;
  if (input.lastOutcome !== "refused") return false;
  if (input.tool === "none" || input.tool === "unknown") return false;
  return LOOPABLE.has(input.tool);
}

/**
 * What the model is told before it tries again.
 *
 * The refusal itself, and nothing else. Not a hint about which field to change,
 * not an example of a well-formed draft: those would be teaching it to satisfy
 * the parser rather than to read the person. What it needs is the fact that the
 * attempt was rejected and the reason the code gave.
 */
export function retryInstruction(reason: string, attempt: number): string {
  return [
    `YOUR PREVIOUS DRAFT WAS REFUSED (attempt ${attempt} of ${MAX_STEPS}).`,
    `The reason: ${reason}`,
    "",
    "Read the user's message again and send one corrected draft. Use only what",
    "they actually said; if a field is genuinely not in their message, leave the",
    "draft alone and answer them in words instead. Do not request any other tool.",
  ].join("\n");
}
