import { and, count, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { monthQuota, planConfig, transactions, type User } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { transactionDedupKey } from "@/lib/dedup";
import { isRealDate, istMonthRange, istToday } from "@/lib/time";

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
function monthBounds(day: string): { start: string; endExclusive: string } {
  const start = `${day.slice(0, 7)}-01`;
  const [year, month] = start.split("-").map(Number);
  const endExclusive =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  return { start, endExclusive };
}

export async function countInMonth(
  userId: string,
  day: string,
): Promise<number> {
  const { start, endExclusive } = monthBounds(day);

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
  // Shape and reality: "2026-02-30" is well formed and is not a day.
  if (!isRealDate(input.occurredOn)) {
    return { ok: false, reason: "invalid", message: "Enter a valid date." };
  }

  if (input.occurredOn > istToday()) {
    return { ok: false, reason: "invalid", message: "That date is in the future." };
  }

  // Counted against the month the transaction belongs to, so a back-dated row
  // is limited by its own month rather than escaping the cap entirely.
  const cap = await planLimitFor(user);
  const month = input.occurredOn.slice(0, 7);

  if (cap !== null) {
    const counted = await countInMonth(user.id, input.occurredOn);
    if (counted >= cap) {
      return { ok: false, reason: "cap_reached", cap, month };
    }
    // The count above only decides where a fresh counter starts. Whether there
    // is room is decided by the reservation, which is atomic.
    if (!(await reserveMonthSlot(user.id, month, cap, counted))) {
      return { ok: false, reason: "cap_reached", cap, month };
    }
  }

  /**
   * Categories are a fixed list, so anything else becomes "Other".
   *
   * The form offers a select, but a server action takes whatever is posted, and
   * an unknown string would flow into the insights breakdown and into the
   * agent's facts as though it were a real category.
   */
  const category = (CATEGORIES as readonly string[]).includes(input.category)
    ? input.category
    : "Other";

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
        category,
        amountPaise: input.amountPaise,
        occurredOn: input.occurredOn,
        source: input.source ?? "manual",
        dedupKey,
      })
      .returning({ id: transactions.id });

    return { ok: true, id: row.id };
  } catch (error) {
    // The slot was taken on the promise of a row that never arrived.
    if (cap !== null) await releaseMonthSlot(user.id, month);

    // The unique index is the authority on what counts as a duplicate, so a
    // constraint violation is an expected outcome here rather than a fault.
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/**
 * Take one slot of the month's cap, or report that there is none left.
 *
 * The whole rule is this one statement. `ON CONFLICT DO UPDATE` locks the
 * existing row, re-reads it, and evaluates the `WHERE` against the value it
 * finds rather than against anything this request read earlier — so six
 * requests arriving at nineteen of twenty queue on the row and exactly one is
 * allowed through.
 *
 * The row is created lazily from the real count, which is what lets seeded and
 * imported history be respected without a backfill: the first reservation in a
 * month starts the counter where the data already is.
 */
async function reserveMonthSlot(
  userId: string,
  month: string,
  cap: number,
  countedSoFar: number,
): Promise<boolean> {
  const reserved = await db
    .insert(monthQuota)
    .values({ userId, month, used: countedSoFar + 1 })
    .onConflictDoUpdate({
      target: [monthQuota.userId, monthQuota.month],
      set: { used: sql`${monthQuota.used} + 1` },
      setWhere: sql`${monthQuota.used} < ${cap}`,
    })
    .returning({ used: monthQuota.used });

  return reserved.length > 0;
}

/**
 * Hand a slot back.
 *
 * Every path out of `addTransaction` after a successful reservation releases on
 * the way — a duplicate, a bad write, anything thrown. Only the process being
 * killed between the two statements can leave a slot spoken for, and the next
 * month starts clean.
 */
async function releaseMonthSlot(userId: string, month: string): Promise<void> {
  await db
    .update(monthQuota)
    .set({ used: sql`greatest(${monthQuota.used} - 1, 0)` })
    .where(and(eq(monthQuota.userId, userId), eq(monthQuota.month, month)));
}

export async function deleteTransaction(
  user: User,
  id: string,
): Promise<boolean> {
  const removed = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
    .returning({ id: transactions.id, occurredOn: transactions.occurredOn });

  // Give the month its slot back, or a Free account would be able to delete a
  // row and still be told the month is full.
  if (removed.length > 0) {
    await releaseMonthSlot(user.id, removed[0].occurredOn.slice(0, 7));
  }

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
