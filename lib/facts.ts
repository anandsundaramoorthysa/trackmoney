import { and, desc, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { planConfig, transactions, type User } from "@/lib/db/schema";
import { detectRecurring, type RecurringCandidate } from "@/lib/recurring";
import { computeMonthInsights, FREE_CATEGORY_LIMIT } from "@/lib/insights";
import { istMonthRange, shiftDays } from "@/lib/time";

/**
 * The deterministic fact layer — PLAN.md §6.8, layer 1.
 *
 * No LLM is involved here and none may be. Every number the agent is ever
 * allowed to say is produced by this function from real rows, and the object it
 * returns is stored verbatim in `agent_events.facts` alongside whatever
 * sentence the model wrapped around it.
 */

export type { RecurringCandidate };

export type UsageFacts = {
  userName: string;
  currentPlan: "free" | "pro";
  monthLabel: string;
  txnCountThisMonth: number;
  freeTxnCap: number;
  /** How many more this month's plan will accept. Zero once the cap is hit. */
  remainingOnFree: number;
  /** True when the Free plan will refuse the next transaction. */
  atCap: boolean;
  recurringCandidates: RecurringCandidate[];
  recurringCount: number;
  recurringMonthlyTotalPaise: number;
  totalSpentPaise: number;
  previousTotalSpentPaise: number;
  /**
   * What the agent may discuss, already trimmed to the plan.
   *
   * Free sees three categories in the interface, so the agent is given three.
   * Handing it the whole breakdown would let it answer, in conversation, a
   * question the product charges to answer.
   */
  categories: {
    category: string;
    totalPaise: number;
    changePaise: number;
  }[];
  proPricePaise: number;
  /** How many of this month's transactions the current plan will show. */
  visibleTxnCap: number | null;
  /** Whether the current plan reveals which charges recur, or only how many. */
  showsRecurringDetail: boolean;
  freeFeatures: string[];
  proFeatures: string[];
  /** Feature strings Pro has that Free does not — the honest delta. */
  proOnlyFeatures: string[];
  computedAt: string;
};

export async function computeUsageFacts(user: User): Promise<UsageFacts> {
  const month = istMonthRange();
  const lookbackStart = shiftDays(month.start, -120);

  const [insights, plansAndRows] = await Promise.all([
    computeMonthInsights(user.id),
    Promise.all([
    db.select().from(planConfig),
    db
      .select({
        merchant: transactions.merchant,
        amountPaise: transactions.amountPaise,
        occurredOn: transactions.occurredOn,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          gte(transactions.occurredOn, lookbackStart),
          lt(transactions.occurredOn, month.endExclusive),
        ),
      )
      .orderBy(desc(transactions.occurredOn)),
    ]),
  ]);
  const [plans, recentRows] = plansAndRows;

  const free = plans.find((p) => p.plan === "free");
  const pro = plans.find((p) => p.plan === "pro");

  if (!free || !pro) {
    throw new Error(
      "plan_config is missing the free/pro rows. Run `npm run db:seed`.",
    );
  }

  const thisMonthRows = recentRows.filter(
    (r) => r.occurredOn >= month.start && r.occurredOn < month.endExclusive,
  );

  const current = user.plan === "pro" ? pro : free;
  const cap = free.txnCapPerMonth ?? 0;
  const txnCount = thisMonthRows.length;
  const recurring = detectRecurring(recentRows);

  const freeFeatures = free.features ?? [];
  const proFeatures = pro.features ?? [];

  return {
    userName: user.name,
    currentPlan: user.plan,
    monthLabel: month.label,
    txnCountThisMonth: txnCount,
    freeTxnCap: cap,
    remainingOnFree: Math.max(0, cap - txnCount),
    atCap: txnCount >= cap,
    recurringCandidates: recurring,
    recurringCount: recurring.length,
    recurringMonthlyTotalPaise: recurring.reduce(
      (sum, r) => sum + r.amountPaise,
      0,
    ),
    totalSpentPaise: insights.totalPaise,
    previousTotalSpentPaise: insights.previousTotalPaise,
    categories: (user.plan === "pro"
      ? insights.categories
      : insights.categories.slice(0, FREE_CATEGORY_LIMIT)
    ).map((row) => ({
      category: row.category,
      totalPaise: row.totalPaise,
      changePaise: row.changePaise,
    })),
    proPricePaise: pro.pricePaise,
    visibleTxnCap: current.txnCapPerMonth,
    showsRecurringDetail: current.recurringDetection,
    freeFeatures,
    proFeatures,
    proOnlyFeatures: proFeatures.filter((f) => !freeFeatures.includes(f)),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Is there anything honest to pitch?
 *
 * The cap is now enforced, so an account can sit *at* it but never past it.
 * Reaching it — or being one away — is a real event worth mentioning; so is
 * having recurring charges Free will not name. Anything else and the agent has
 * no case to make and must not invent one.
 */
export function hasUpgradeCase(facts: UsageFacts): boolean {
  if (facts.currentPlan === "pro") return false;
  return facts.atCap || facts.remainingOnFree <= 1 || facts.recurringCount > 0;
}
