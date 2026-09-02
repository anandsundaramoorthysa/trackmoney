import { and, count, eq, gt, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { monthQuota, planConfig, transactions, type User } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { transactionDedupKey } from "@/lib/dedup";
import { isRealDate, istMonthRange, istToday } from "@/lib/time";
import { CATEGORIES } from "@/lib/categories";

/**
 * Writing a transaction
 *
 * This is the only place a transaction is created, so the plan's limit is
 * enforced here and cannot be sidestepped by a second code path. That matters
 * more than it sounds: before this existed, the Free cap only decided how many
 * rows to *display*, which meant the product advertised a limit it did not keep.
 */

// Re-exported so existing server-side imports keep working; the list itself
// lives in a module the browser can import without pulling in the database.
export { CATEGORIES };

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

/**
 * The oldest and newest months this account has anything in.
 *
 * The month pager needs to know where to stop going back, and an empty month
 * needs to be able to point at one that is not empty. Both are one question
 * about the extremes, so it is one query rather than two.
 */
export async function monthsWithActivity(userId: string): Promise<{
  earliest: string | null;
  latest: string | null;
}> {
  const [row] = await db
    .select({
      earliest: sql<string | null>`min(${transactions.occurredOn})`,
      latest: sql<string | null>`max(${transactions.occurredOn})`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  return {
    earliest: row?.earliest ? row.earliest.slice(0, 7) : null,
    latest: row?.latest ? row.latest.slice(0, 7) : null,
  };
}

/**
 * Why a row cannot be written, decided in one place.
 *
 * The preview and the commit used to answer this separately: the preview
 * checked for duplicates, and the commit — through `addTransaction` — also
 * refused future dates and impossible ones. So a statement dated next week
 * previewed as importable, ticked and ready, and then came back "2 could not be
 * read". The rows were perfectly readable. They were refused on policy, and the
 * commit had no vocabulary for saying so.
 *
 * Both paths call this now, so the preview cannot offer a row the commit will
 * turn away.
 */
export type RowRefusal = "future" | "invalid_date" | "invalid_amount" | "no_merchant";

export function refusalFor(row: {
  merchant: string;
  amountPaise: number;
  occurredOn: string;
}): RowRefusal | null {
  if (!row.merchant.trim()) return "no_merchant";
  if (!Number.isInteger(row.amountPaise) || row.amountPaise <= 0) {
    return "invalid_amount";
  }
  if (row.amountPaise > MAX_AMOUNT_PAISE) return "invalid_amount";
  if (!isRealDate(row.occurredOn)) return "invalid_date";
  if (row.occurredOn > istToday()) return "future";

  return null;
}

/** How to say each of those to somebody reading a preview. */
export const ROW_REFUSAL_LABELS: Record<RowRefusal, string> = {
  future: "dated in the future",
  invalid_date: "not a real date",
  invalid_amount: "amount cannot be read",
  no_merchant: "no merchant name",
};

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
  const take = async () =>
    (
      await db
        .insert(monthQuota)
        .values({ userId, month, used: countedSoFar + 1 })
        .onConflictDoUpdate({
          target: [monthQuota.userId, monthQuota.month],
          set: { used: sql`${monthQuota.used} + 1`, updatedAt: new Date() },
          setWhere: sql`${monthQuota.used} < ${cap}`,
        })
        .returning({ used: monthQuota.used })
    ).length > 0;

  if (await take()) return true;

  // The month is full as far as the counter is concerned. That is either true,
  // or the counter is holding a slot nothing ever claimed.
  return (await reclaimStrandedSlots(userId, month, cap, countedSoFar))
    ? take()
    : false;
}

/**
 * How long a reservation may outlive the row it promised.
 *
 * Reserving and inserting are two statements, and every ordinary failure
 * between them releases on the way out. A process killed in that gap cannot,
 * and the slot would then be spoken for by nothing until the month ended.
 *
 * A whole minute is far longer than the gap it is covering — the two statements
 * run back to back — so a reservation still older than this is not in flight,
 * it is abandoned.
 */
const STRANDED_AFTER_MS = 60_000;

/**
 * Put back slots that were reserved by requests that never wrote anything.
 *
 * The comparison that matters is the counter against the rows actually on disk.
 * Doing it on age alone would be wrong: during a burst, several reservations
 * legitimately sit above the row count for a few milliseconds, and reclaiming
 * those would let the cap be exceeded — the exact bug this counter exists to
 * prevent. Hence both conditions, and hence the compare-and-swap: two requests
 * reconciling at once, only one may win, and the loser simply retries against
 * the value the winner left.
 */
async function reclaimStrandedSlots(
  userId: string,
  month: string,
  cap: number,
  actualRows: number,
): Promise<boolean> {
  if (actualRows >= cap) return false;

  const corrected = await db
    .update(monthQuota)
    .set({ used: actualRows, updatedAt: new Date() })
    .where(
      and(
        eq(monthQuota.userId, userId),
        eq(monthQuota.month, month),
        gt(monthQuota.used, actualRows),
        lt(monthQuota.updatedAt, new Date(Date.now() - STRANDED_AFTER_MS)),
      ),
    )
    .returning({ used: monthQuota.used });

  return corrected.length > 0;
}

/**
 * Hand a slot back.
 *
 * Every path out of `addTransaction` after a successful reservation releases on
 * the way — a duplicate, a bad write, anything thrown. A process killed between
 * the two statements cannot, which is what `reclaimStrandedSlots` is for.
 */
async function releaseMonthSlot(userId: string, month: string): Promise<void> {
  await db
    .update(monthQuota)
    .set({ used: sql`greatest(${monthQuota.used} - 1, 0)`, updatedAt: new Date() })
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
