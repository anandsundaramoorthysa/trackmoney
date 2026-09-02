import { and, eq } from "drizzle-orm";

import { isMatchType, type CategoryRule, type MatchType } from "@/lib/categorize";
import { db } from "@/lib/db";
import { categoryRules } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { CATEGORIES } from "@/lib/categories";

/**
 * Storing the rules that turn a merchant name into a category.
 *
 * The matching itself lives in lib/categorize.ts and knows nothing about the
 * database, so it can be tested on its own. This file is only the way in and
 * out of storage, and the place where anything a person typed is checked
 * before it is kept.
 */

/** How many rules one account may keep. */
export const MAX_RULES = 100;

export async function listRules(userId: string): Promise<CategoryRule[]> {
  const rows = await db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId));

  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    matchType: row.matchType,
    category: row.category,
    priority: row.priority,
    enabled: row.enabled,
  }));
}

export type CreateRuleResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid" | "duplicate" | "too_many"; message: string };

export async function createRule(input: {
  userId: string;
  pattern: string;
  matchType: string;
  category: string;
  priority?: number;
}): Promise<CreateRuleResult> {
  const pattern = input.pattern.trim().slice(0, 80);

  if (pattern.length < 2) {
    return {
      ok: false,
      reason: "invalid",
      message: "A pattern needs at least two characters.",
    };
  }

  if (!isMatchType(input.matchType)) {
    return { ok: false, reason: "invalid", message: "Unknown match type." };
  }

  // Categories are a fixed list; a rule pointing outside it would write a
  // category nothing else in the app can group or display.
  if (!(CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, reason: "invalid", message: "Unknown category." };
  }

  const existing = await db
    .select({ id: categoryRules.id })
    .from(categoryRules)
    .where(eq(categoryRules.userId, input.userId));

  if (existing.length >= MAX_RULES) {
    return {
      ok: false,
      reason: "too_many",
      message: `That is more than ${MAX_RULES} rules. Delete one before adding another.`,
    };
  }

  try {
    const [row] = await db
      .insert(categoryRules)
      .values({
        userId: input.userId,
        pattern,
        matchType: input.matchType as MatchType,
        category: input.category,
        priority: Number.isInteger(input.priority) ? input.priority! : 0,
      })
      .returning({ id: categoryRules.id });

    return { ok: true, id: row.id };
  } catch (error) {
    // The unique index is the authority on what counts as the same rule.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "duplicate",
        message: "There is already a rule for that pattern.",
      };
    }
    throw error;
  }
}

/** Scoped to the owner, so an id from somewhere else deletes nothing. */
export async function deleteRule(userId: string, id: string): Promise<boolean> {
  const removed = await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning({ id: categoryRules.id });

  return removed.length > 0;
}
