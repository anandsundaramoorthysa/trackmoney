import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import { computeUsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { istMonthRange } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Placeholder until Phase 2 — kept honest rather than faked. */
export default async function InsightsPage() {
  const user = await requireUser();
  const facts = await computeUsageFacts(user);
  const month = istMonthRange();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Insights</h1>
        <p className="mt-1 text-sm text-muted">{month.label}</p>
      </div>

      {facts.showsRecurringDetail && facts.recurringCandidates.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
            Recurring charges
          </h2>
          <ul className="divide-y divide-line/60">
            {facts.recurringCandidates.map((c) => (
              <li
                key={`${c.merchant}-${c.amountPaise}`}
                className="flex items-baseline justify-between px-4 py-2 text-sm"
              >
                <span>{c.merchant}</span>
                <span className="font-mono tabular">
                  {formatPaise(c.amountPaise)} · {c.monthsSeen} months
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-muted">
          <p>
            Free counts how many of your charges repeat each month — currently{" "}
            <span className="font-mono text-ink">{facts.recurringCount}</span> —
            but does not name them.
          </p>
          <p className="mt-2">
            <Link href="/billing" className="text-brand hover:underline">
              Pro
            </Link>{" "}
            lists each one with its amount, and adds a category breakdown.
          </p>
        </section>
      )}
    </div>
  );
}
