import { and, eq, gte, lt, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { istMonthRange, shiftDays } from "@/lib/time";

/**
 * Category breakdown — PLAN.md §10.4.
 *
 * Deterministic, like everything else the agent is allowed to talk about. The
 * previous month is fetched alongside so a change can be stated as a fact
 * rather than as an impression.
 */

export type CategoryTotal = {
  category: string;
  totalPaise: number;
  /**
   * Whole-percent share of the month, rounded independently. Three equal
   * categories therefore read 33% each and total 99 — the figures are each
   * correct and the column is not guaranteed to sum to 100.
   */
  sharePercent: number;
  previousPaise: number;
  changePaise: number;
};

export type MonthInsights = {
  monthLabel: string;
  totalPaise: number;
  previousTotalPaise: number;
  categories: CategoryTotal[];
};

async function totalsByCategory(
  userId: string,
  start: string,
  endExclusive: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      category: transactions.category,
      total: sum(transactions.amountPaise),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, endExclusive),
      ),
    )
    .groupBy(transactions.category);

  // sum() comes back as a string from Postgres: it is a bigint, not an int.
  return new Map(rows.map((row) => [row.category, Number(row.total ?? 0)]));
}

export async function computeMonthInsights(
  userId: string,
): Promise<MonthInsights> {
  const month = istMonthRange();
  const previousStart = shiftDays(month.start, -1).slice(0, 8) + "01";

  const [current, previous] = await Promise.all([
    totalsByCategory(userId, month.start, month.endExclusive),
    totalsByCategory(userId, previousStart, month.start),
  ]);

  const totalPaise = [...current.values()].reduce((a, b) => a + b, 0);
  const previousTotalPaise = [...previous.values()].reduce((a, b) => a + b, 0);

  const categories: CategoryTotal[] = [...current.entries()]
    .map(([category, amount]) => {
      const previousPaise = previous.get(category) ?? 0;
      return {
        category,
        totalPaise: amount,
        sharePercent:
          totalPaise > 0 ? Math.round((amount / totalPaise) * 100) : 0,
        previousPaise,
        changePaise: amount - previousPaise,
      };
    })
    .sort((a, b) => b.totalPaise - a.totalPaise);

  return {
    monthLabel: month.label,
    totalPaise,
    previousTotalPaise,
    categories,
  };
}

/** What Free shows of the breakdown. Pro sees all of it. */
export const FREE_CATEGORY_LIMIT = 3;
