import { CATEGORIES } from "@/lib/categories";

/**
 * Deciding a category from a merchant name.
 *
 * Importing a statement used to leave every row in whatever category the file
 * happened to name, or in "Other" when it named none — which is most files.
 * A ledger where everything is "Other" tells you nothing, and re-typing a
 * hundred categories by hand is the reason people stop using a tracker.
 *
 * The engine is deliberately pure: no database, no request, no clock. It takes
 * rules and a description and returns a decision, which is what makes it
 * testable on its own and what lets the import preview show a category before
 * anything has been written.
 */

/** How a rule's pattern is compared against a merchant name. */
export const MATCH_TYPES = ["contains", "equals", "starts_with", "word"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export function isMatchType(value: unknown): value is MatchType {
  return typeof value === "string" && (MATCH_TYPES as readonly string[]).includes(value);
}

export type CategoryRule = {
  id: string;
  pattern: string;
  matchType: MatchType;
  category: string;
  /** Higher wins. Ties break on the longer pattern, which is the more specific. */
  priority: number;
  enabled: boolean;
};

export type RuleMatch = {
  category: string;
  /** The rule that decided it, so the interface can say why. */
  rule: CategoryRule;
};

/**
 * Regex is deliberately not one of the match types.
 *
 * These rules are written by people in a text box and then run against every
 * imported row. A pattern like `(a+)+$` on a long merchant name backtracks
 * catastrophically, and the person who typed it has no way to know. The four
 * types here cover what statement descriptions actually need and none of them
 * can be made to hang.
 */
function matches(rule: CategoryRule, description: string): boolean {
  if (!rule.enabled) return false;

  const haystack = description.trim().toLowerCase();
  const needle = rule.pattern.trim().toLowerCase();
  if (!needle) return false;

  switch (rule.matchType) {
    case "contains":
      return haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "starts_with":
      return haystack.startsWith(needle);
    case "word":
      // Whole-word, without a regex: split on anything that is not a letter or
      // a digit, so "ola" matches "OLA CABS" but not "Motorola".
      return haystack.split(/[^\p{L}\p{N}]+/u).includes(needle);
    default:
      return false;
  }
}

/**
 * The category for this description, or null if no rule claims it.
 *
 * Sorted by priority and then by pattern length: when two rules both match,
 * the more specific one — the longer pattern — is almost always the one the
 * person meant. "swiggy instamart" should beat "swiggy" without anyone having
 * to think about priority numbers.
 */
export function categoryFor(
  rules: CategoryRule[],
  description: string,
): RuleMatch | null {
  const ordered = [...rules].sort(
    (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length,
  );

  for (const rule of ordered) {
    if (!(CATEGORIES as readonly string[]).includes(rule.category)) continue;
    if (matches(rule, description)) return { category: rule.category, rule };
  }

  return null;
}

/**
 * A rule suggested from a row the person has just categorised by hand.
 *
 * Offered rather than applied: the merchant name in a statement is often one
 * booking reference away from being unique ("UPI/1234/SWIGGY/..."), so the
 * useful pattern is a recognisable word inside it, not the whole string. The
 * longest alphabetic word is a good guess and a bad decision to make silently.
 */
export function suggestPattern(description: string): {
  pattern: string;
  matchType: MatchType;
} | null {
  const words = description
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w));

  if (words.length === 0) return null;

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  return { pattern: longest, matchType: "word" };
}
