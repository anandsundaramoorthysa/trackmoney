import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  agentEvents,
  conversations,
  monthQuota,
  payments,
  planConfig,
  transactions,
  users,
} from "@/lib/db/schema";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "@/lib/demo";
import { transactionDedupKey } from "@/lib/dedup";
import { isoDate, istYearMonth } from "@/lib/time";

/**
 * Demo data.
 *
 * Seeded, not typed in live, so the demo never depends on a judge entering
 * data during a five-minute pitch. The numbers are chosen so the account sits
 * just over the Free cap with a few genuinely recurring charges, which is the
 * situation the agent is supposed to notice.
 *
 * Everything here is fictional. No real person's spending is represented.
 */

const FREE_TXN_CAP = 20;
const PRO_PRICE_PAISE = 49_900; // ₹499 one-time

/** Charged every month at the same amount — this is what Pro can detect. */
const RECURRING = [
  { merchant: "Netflix India", category: "Entertainment", amountPaise: 64_900, day: 4 },
  { merchant: "Cult.fit", category: "Health", amountPaise: 1_49_900, day: 7 },
  { merchant: "Spotify Premium", category: "Entertainment", amountPaise: 11_900, day: 12 },
];

type Spend = {
  merchant: string;
  category: string;
  amountPaise: number;
  day: number;
};

/**
 * One-off spending. Amounts are distinct so nothing is recurring by accident.
 *
 * Sized so the seeded month lands on 19 of the Free plan's 20. A judge adds the
 * twentieth themselves and is refused the twenty-first, which is a far better
 * demonstration of the limit than being shown an account that had already
 * exceeded it — and it stops the product contradicting its own rule.
 */
const CURRENT_MONTH_ONE_OFFS: Spend[] = [
  { merchant: "BigBasket", category: "Groceries", amountPaise: 2_84_700, day: 1 },
  { merchant: "Namma Metro", category: "Transport", amountPaise: 6_000, day: 2 },
  { merchant: "Third Wave Coffee", category: "Food & Drink", amountPaise: 38_000, day: 3 },
  { merchant: "Swiggy", category: "Food & Drink", amountPaise: 47_250, day: 5 },
  { merchant: "Indian Oil", category: "Transport", amountPaise: 1_20_000, day: 6 },
  { merchant: "Blinkit", category: "Groceries", amountPaise: 63_400, day: 8 },
  { merchant: "Apollo Pharmacy", category: "Health", amountPaise: 41_800, day: 9 },
  { merchant: "Uber", category: "Transport", amountPaise: 27_600, day: 10 },
  { merchant: "Zomato", category: "Food & Drink", amountPaise: 52_900, day: 11 },
  { merchant: "Decathlon", category: "Shopping", amountPaise: 2_19_900, day: 13 },
  { merchant: "BESCOM", category: "Utilities", amountPaise: 1_86_300, day: 14 },
  { merchant: "Airtel Postpaid", category: "Utilities", amountPaise: 79_900, day: 15 },
  { merchant: "Blinkit", category: "Groceries", amountPaise: 31_250, day: 16 },
  { merchant: "PVR Cinemas", category: "Entertainment", amountPaise: 88_000, day: 17 },
  { merchant: "Swiggy Instamart", category: "Groceries", amountPaise: 74_600, day: 19 },
  { merchant: "Amazon.in", category: "Shopping", amountPaise: 3_49_000, day: 21 },
];

const LAST_MONTH_ONE_OFFS: Spend[] = [
  { merchant: "BigBasket", category: "Groceries", amountPaise: 3_11_200, day: 2 },
  { merchant: "Swiggy", category: "Food & Drink", amountPaise: 39_900, day: 5 },
  { merchant: "Indian Oil", category: "Transport", amountPaise: 1_15_000, day: 9 },
  { merchant: "BESCOM", category: "Utilities", amountPaise: 1_72_400, day: 14 },
  { merchant: "Airtel Postpaid", category: "Utilities", amountPaise: 79_800, day: 15 },
  { merchant: "Uber", category: "Transport", amountPaise: 22_300, day: 18 },
  { merchant: "Croma", category: "Shopping", amountPaise: 4_99_000, day: 22 },
  { merchant: "Zomato", category: "Food & Drink", amountPaise: 61_100, day: 26 },
];

const TWO_MONTHS_AGO_ONE_OFFS: Spend[] = [
  { merchant: "BigBasket", category: "Groceries", amountPaise: 2_67_800, day: 3 },
  { merchant: "Uber", category: "Transport", amountPaise: 31_900, day: 8 },
  { merchant: "BESCOM", category: "Utilities", amountPaise: 1_59_700, day: 14 },
  { merchant: "Swiggy", category: "Food & Drink", amountPaise: 44_150, day: 21 },
  { merchant: "Lenskart", category: "Shopping", amountPaise: 2_45_000, day: 25 },
];

function monthOffset(offset: number): { year: number; month: number } {
  const { year, month } = istYearMonth();
  const zeroBased = month - 1 + offset;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function currentMonthPrefix(): string {
  const { year, month } = istYearMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function istDayOfMonth(): number {
  return new Date(Date.now() + (5 * 60 + 30) * 60_000).getUTCDate();
}

function buildMonth(
  userId: string,
  offset: number,
  spends: Spend[],
  { clampToToday }: { clampToToday: boolean },
) {
  const { year, month } = monthOffset(offset);
  // For the current month, nothing may be dated in the future.
  const maxDay = clampToToday ? istDayOfMonth() : daysInMonth(year, month);

  return spends.map((s) => {
    const occurredOn = isoDate(year, month, Math.max(1, Math.min(s.day, maxDay)));
    return {
      userId,
      merchant: s.merchant,
      category: s.category,
      amountPaise: s.amountPaise,
      occurredOn,
      source: "seed" as const,
      dedupKey: transactionDedupKey({
        userId,
        occurredOn,
        amountPaise: s.amountPaise,
        merchant: s.merchant,
      }),
    };
  });
}

export type SeedSummary = {
  userId: string;
  transactionsInserted: number;
  transactionsThisMonth: number;
};

/**
 * Wipes and rebuilds the demo account. Used by `npm run db:seed` and by the
 * "Reset demo data" button, so a run-through can always be replayed cleanly
 * in front of a panel.
 */
export async function seedDatabase(): Promise<SeedSummary> {
  // plan_config has no dependents, so a clean rewrite is simpler and more
  // predictable than an upsert.
  await db.delete(planConfig);
  await db.insert(planConfig).values([
    {
      plan: "free",
      label: "Free",
      txnCapPerMonth: FREE_TXN_CAP,
      recurringDetection: false,
      pricePaise: 0,
      features: [
        `Up to ${FREE_TXN_CAP} transactions a month`,
        "Counts how many charges look recurring",
        "Your top 3 spending categories",
      ],
    },
    {
      plan: "pro",
      label: "Pro",
      txnCapPerMonth: null,
      recurringDetection: true,
      pricePaise: PRO_PRICE_PAISE,
      features: [
        "Unlimited transactions a month",
        "Names the recurring charges it finds, not just the count",
        "Every spending category, with the change against last month",
        "Import a statement from CSV",
        "CSV export of the month's transactions",
      ],
    },
  ]);

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_USER_EMAIL,
      name: DEMO_USER_NAME,
      plan: "free",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { plan: "free", name: DEMO_USER_NAME },
    })
    .returning();

  /**
   * Scoped to the demo account, and it must stay that way.
   *
   * These deletes used to be unqualified, which was harmless while there was
   * one account and destructive the moment sign-up existed: the reset button
   * sits on a dashboard anyone can reach, so a visitor could wipe every other
   * account's transactions, payments and history while their user row stayed
   * behind looking intact.
   */
  await db.delete(agentEvents).where(eq(agentEvents.userId, user.id));
  await db.delete(payments).where(eq(payments.userId, user.id));
  await db.delete(conversations).where(eq(conversations.userId, user.id));
  await db.delete(transactions).where(eq(transactions.userId, user.id));
  // The cap counter is derived from these rows, so it has to go with them or
  // the reseeded account would start its month already spoken for.
  await db.delete(monthQuota).where(eq(monthQuota.userId, user.id));

  const rows = [
    ...buildMonth(user.id, 0, [...RECURRING, ...CURRENT_MONTH_ONE_OFFS], {
      clampToToday: true,
    }),
    ...buildMonth(user.id, -1, [...RECURRING, ...LAST_MONTH_ONE_OFFS], {
      clampToToday: false,
    }),
    ...buildMonth(user.id, -2, [...RECURRING, ...TWO_MONTHS_AGO_ONE_OFFS], {
      clampToToday: false,
    }),
  ];

  // The seed can collide with itself when the current month is clamped to an
  // early day, since two spends then share a date. Dropping duplicates here
  // keeps the seed honest about what a unique index would allow.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.dedupKey)) return false;
    seen.add(r.dedupKey);
    return true;
  });

  await db.insert(transactions).values(unique);

  return {
    userId: user.id,
    transactionsInserted: unique.length,
    transactionsThisMonth: unique.filter((r) =>
      r.occurredOn.startsWith(currentMonthPrefix()),
    ).length,
  };
}
