import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import { computeUsageFacts } from "@/lib/facts";
import { computeMonthInsights, FREE_CATEGORY_LIMIT } from "@/lib/insights";
import { formatPaise } from "@/lib/money";
import { istMonthRange, resolveMonth } from "@/lib/time";
import { monthsWithActivity } from "@/lib/transactions";
import { EmptyMonthNotice, MonthNav } from "@/components/MonthNav";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();

  // The breakdown was pinned to the current month, so an imported statement
  // from an earlier one had nowhere to be seen. It is chosen by the address
  // now, exactly as the ledger is.
  const currentMonth = istMonthRange().start.slice(0, 7);
  const shownMonth = resolveMonth((await searchParams).month);

  const [facts, insights, activity] = await Promise.all([
    computeUsageFacts(user),
    computeMonthInsights(user.id, shownMonth),
    monthsWithActivity(user.id),
  ]);

  const isPro = user.plan === "pro";
  const shown = isPro
    ? insights.categories
    : insights.categories.slice(0, FREE_CATEGORY_LIMIT);
  const withheld = insights.categories.length - shown.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Insights</h1>
          <p className="mt-1 text-sm text-muted">
            {insights.monthLabel} · {formatPaise(insights.totalPaise)} spent
          </p>
        </div>
        <MonthNav
          month={shownMonth}
          currentMonth={currentMonth}
          earliestMonth={activity.earliest}
          basePath="/insights"
        />
      </div>

      {insights.categories.length === 0 &&
        activity.latest &&
        activity.latest !== shownMonth && (
          <EmptyMonthNotice
            month={shownMonth}
            nearest={activity.latest}
            basePath="/insights"
          />
        )}

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          Where the money went
        </h2>

        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            Nothing logged this month yet.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {shown.map((row) => (
              <li key={row.category} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{row.category}</span>
                  <span className="font-mono text-sm tabular">
                    {formatPaise(row.totalPaise)}
                  </span>
                </div>

                {/* A bar rather than a chart library: one number, one length. */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.max(row.sharePercent, 2)}%` }}
                  />
                </div>

                <div className="mt-1.5 flex items-baseline justify-between text-xs text-muted">
                  <span>{row.sharePercent}% of the month</span>
                  {isPro ? (
                    <span
                      className={
                        row.changePaise > 0
                          ? "text-bad"
                          : row.changePaise < 0
                            ? "text-ok"
                            : ""
                      }
                    >
                      {row.previousPaise === 0
                        ? "new this month"
                        : `${row.changePaise >= 0 ? "+" : "−"}${formatPaise(
                            Math.abs(row.changePaise),
                          )} vs last month`}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isPro && withheld > 0 && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            Free shows your top {FREE_CATEGORY_LIMIT} categories. Pro shows all{" "}
            {insights.categories.length}, with the change against last month.{" "}
            <Link href="/billing" className="text-brand hover:underline">
              See Pro
            </Link>
          </p>
        )}
      </section>

      {facts.showsRecurringDetail ? (
        facts.recurringCandidates.length > 0 && (
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
        )
      ) : (
        <section className="rounded-xl border border-line bg-surface px-4 py-4 text-sm text-muted">
          Free counts how many of your charges repeat each month — currently{" "}
          <span className="font-mono text-ink">{facts.recurringCount}</span> —
          but does not name them.{" "}
          <Link href="/billing" className="text-brand hover:underline">
            Pro
          </Link>{" "}
          lists each one with its amount.
        </section>
      )}
    </div>
  );
}
