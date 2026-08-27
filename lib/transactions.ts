import { and, count, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { planConfig, transactions, type User } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { transactionDedupKey } from "@/lib/dedup";
import { istMonthRange, istToday } from "@/lib/time";

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

/**
 * The largest amount the column can hold.
 *
 * `amount_paise` is a Postgres integer, so anything past this overflows and the
 * driver throws — which reached the user as a 500 rather than as a refusal. A
 * limit the product has is a limit the product should state.
 */
export const MAX_AMOUNT_PAISE = 2_147_483_647;

export type AddResult =
  | { ok: true; id: string }
  | { ok: false; reason: "cap_reached"; cap: number; month: string }
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
  return countInMonth(userId, istMonthRange().start);
}

/**
 * How many transactions an account has in the calendar month containing `day`.
 *
 * The cap has to be counted against the month a transaction *belongs to*, not
 * the month it happens to be entered in. Counting only the current month meant
 * a Free account could add any number of back-dated rows: the limit guarded one
 * month and left every other one wide open.
 */
export async function countInMonth(
  userId: string,
  day: string,
): Promise<number> {
  const start = `${day.slice(0, 7)}-01`;
  const [year, month] = start.split("-").map(Number);
  const endExclusive =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const [row] = await db
    .select({ total: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, endExclusive),
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
  if (input.amountPaise > MAX_AMOUNT_PAISE) {
    return {
      ok: false,
      reason: "invalid",
      message: "That amount is larger than this app can record.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
    return { ok: false, reason: "invalid", message: "Enter a valid date." };
  }

  if (input.occurredOn > istToday()) {
    return { ok: false, reason: "invalid", message: "That date is in the future." };
  }

  // Counted against the month the transaction belongs to, so a back-dated row
  // is limited by its own month rather than escaping the cap entirely.
  const cap = await planLimitFor(user);
  if (cap !== null && (await countInMonth(user.id, input.occurredOn)) >= cap) {
    return {
      ok: false,
      reason: "cap_reached",
      cap,
      month: input.occurredOn.slice(0, 7),
    };
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

/** "1,299.50" or "1299.5" -> 129950. Rejects anything that is not a number. */
export function rupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  // Bounded here too, so a caller that formats its own message still cannot
  // hand the database a value it has no room for.
  const paise = Math.round(Number(cleaned) * 100);
  return paise > MAX_AMOUNT_PAISE ? null : paise;
}
