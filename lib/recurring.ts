export type RecurringCandidate = {
  merchant: string;
  amountPaise: number;
  monthsSeen: number;
};

/**
 * Recurring-subscription detection: deliberately a rule, not ML.
 *
 * A merchant counts as recurring when it charged the exact same amount in two
 * or more distinct calendar months. The intelligence this project is judged on
 * lives in the gating and the audit trail, not in the trigger, so a rule that a
 * reader can verify by eye is worth more here than a model that cannot be.
 *
 * Kept free of database imports so it can be tested on its own.
 */
export function detectRecurring(
  rows: { merchant: string; amountPaise: number; occurredOn: string }[],
): RecurringCandidate[] {
  const groups = new Map<
    string,
    { merchant: string; amountPaise: number; months: Set<string> }
  >();

  for (const row of rows) {
    const key = `${row.merchant}::${row.amountPaise}`;
    const month = row.occurredOn.slice(0, 7);
    const existing = groups.get(key);
    if (existing) {
      existing.months.add(month);
    } else {
      groups.set(key, {
        merchant: row.merchant,
        amountPaise: row.amountPaise,
        months: new Set([month]),
      });
    }
  }

  return [...groups.values()]
    .filter((g) => g.months.size >= 2)
    .map((g) => ({
      merchant: g.merchant,
      amountPaise: g.amountPaise,
      monthsSeen: g.months.size,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
}
