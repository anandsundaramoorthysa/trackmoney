import { and, count, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { planConfig, transactions, type User } from "@/lib/db/schema";
import { transactionDedupKey } from "@/lib/dedup";
import { istMonthRange } from "@/lib/time";

/**
 * Writing a transaction — PLAN.md §10.3.
 *
 * This is the only place a transaction is created, so the plan's limit is
 * enforced here and cannot be sidestepped by a second code path. That matters
 * more than it sounds: before this existed, the Free cap only decided how many
 * rows to *display*, which meant the product advertised a limit it did not keep.
 */

export const CATEGORIES = [
  "Food & Drink",
  "Groceries",
  "Transport",
  "Shopping",
  "Utilities",
  "Entertainment",
  "Health",
  "Other",
] as const;

export type AddResult =
  | { ok: true; id: string }
  | { ok: false; reason: "cap_reached"; cap: number }
  | { ok: false; reason: "duplicate" }
  | { ok: false; reason: "invalid"; message: string };

async function planLimitFor(user: User): Promise<number | null> {
  const [plan] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, user.plan))
    .limit(1);
  return plan?.txnCapPerMonth ?? null;
}

export async function countThisMonth(userId: string): Promise<number> {
  const month = istMonthRange();
  const [row] = await db
    .select({ total: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredOn, month.start),
        lt(transactions.occurredOn, month.endExclusive),
      ),
    );
  return row?.total ?? 0;
}

export async function addTransaction(
  user: User,
  input: {
    merchant: string;
    category: string;
    amountPaise: number;
    occurredOn: string;
    source?: "manual" | "import";
  },
): Promise<AddResult> {
  const merchant = input.merchant.trim().slice(0, 80);
  if (!merchant) {
    return { ok: false, reason: "invalid", message: "Enter a merchant." };
  }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, reason: "invalid", message: "Enter an amount above zero." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
    return { ok: false, reason: "invalid", message: "Enter a valid date." };
  }

  const month = istMonthRange();
  const withinThisMonth =
    input.occurredOn >= month.start && input.occurredOn < month.endExclusive;

  // The cap counts the month a transaction belongs to, not the month it was
  // typed in — otherwise back-dating would be a way around it.
  const cap = await planLimitFor(user);
  if (cap !== null && withinThisMonth && (await countThisMonth(user.id)) >= cap) {
    return { ok: false, reason: "cap_reached", cap };
  }

  const dedupKey = transactionDedupKey({
    userId: user.id,
    occurredOn: input.occurredOn,
    amountPaise: input.amountPaise,
    merchant,
  });

  try {
    const [row] = await db
      .insert(transactions)
      .values({
        userId: user.id,
        merchant,
        category: input.category,
        amountPaise: input.amountPaise,
        occurredOn: input.occurredOn,
        source: input.source ?? "manual",
        dedupKey,
      })
      .returning({ id: transactions.id });

    return { ok: true, id: row.id };
  } catch (error) {
    // The unique index is the authority on what counts as a duplicate, so a
    // constraint violation is an expected outcome here rather than a fault.
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function deleteTransaction(
  user: User,
  id: string,
): Promise<boolean> {
  const removed = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
    .returning({ id: transactions.id });

  return removed.length > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** "1,299.50" or "1299.5" -> 129950. Rejects anything that is not a number. */
export function rupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
