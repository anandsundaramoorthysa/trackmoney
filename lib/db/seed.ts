import { db } from "@/lib/db";
import {
  agentEvents,
  conversations,
  payments,
  planConfig,
  transactions,
  users,
} from "@/lib/db/schema";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "@/lib/demo";
import { isoDate, istYearMonth } from "@/lib/time";

/**
 * Demo data — PLAN.md §6.12 step 3.
 *
 * Seeded, not typed in live, so the demo never depends on a judge entering
 * data during a five-minute pitch. The numbers are chosen so the account sits
 * just over the Free cap with a few genuinely recurring charges, which is the
 * situation the agent is supposed to notice.
 *
 * Everything here is fictional. No real person's spending is represented.
 */

const FREE_TXN_CAP = 20;
const PRO_PRICE_PAISE = 49_900; // ₹499 one-time — PLAN.md §6.4

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

/** One-off spending. Amounts are distinct so nothing is recurring by accident. */
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
  { merchant: "Uber", category: "Transport", amountPaise: 19_400, day: 18 },
  { merchant: "Swiggy Instamart", category: "Groceries", amountPaise: 74_600, day: 19 },
  { merchant: "Nykaa", category: "Shopping", amountPaise: 1_34_500, day: 20 },
  { merchant: "Bookmyshow", category: "Entertainment", amountPaise: 45_000, day: 20 },
  { merchant: "Chai Point", category: "Food & Drink", amountPaise: 14_000, day: 21 },
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

  return spends.map((s) => ({
    userId,
    merchant: s.merchant,
    category: s.category,
    amountPaise: s.amountPaise,
    occurredOn: isoDate(year, month, Math.max(1, Math.min(s.day, maxDay))),
  }));
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
        `Shows your most recent ${FREE_TXN_CAP} transactions each month`,
        "Counts how many charges look recurring",
        "Monthly spend summary",
      ],
    },
    {
      plan: "pro",
      label: "Pro",
      txnCapPerMonth: null,
      recurringDetection: true,
      pricePaise: PRO_PRICE_PAISE,
      features: [
        "Shows every transaction in the month, with no cap",
        "Names the recurring charges it finds, not just the count",
        "Monthly spend summary",
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

  // Order matters: agent_events and payments reference the user, conversations
  // cascade into agent_events.
  await db.delete(agentEvents);
  await db.delete(payments);
  await db.delete(conversations);
  await db.delete(transactions);

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

  await db.insert(transactions).values(rows);

  return {
    userId: user.id,
    transactionsInserted: rows.length,
    transactionsThisMonth: RECURRING.length + CURRENT_MONTH_ONE_OFFS.length,
  };
}
