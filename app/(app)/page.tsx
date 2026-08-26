import { and, desc, eq, gte, lt } from "drizzle-orm";

import { AgentPanel } from "@/components/AgentPanel";
import { ResetDemoButton } from "@/components/ResetDemoButton";
import { SetupNotice } from "@/components/SetupNotice";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { computeUsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { istMonthRange } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const user = await requireUser();
    const facts = await computeUsageFacts(user);
    const month = istMonthRange();

    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          gte(transactions.occurredOn, month.start),
          lt(transactions.occurredOn, month.endExclusive),
        ),
      )
      .orderBy(desc(transactions.occurredOn));

    const spent = rows.reduce((sum, r) => sum + r.amountPaise, 0);

    // The Free cap is a real limit on what the plan shows, not a caption. Pro's
    // config row has no cap, so Pro sees the month in full — which is the
    // difference a person actually gets for their money.
    const visible =
      facts.visibleTxnCap === null ? rows : rows.slice(0, facts.visibleTxnCap);
    const hidden = rows.length - visible.length;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {facts.userName}
            </h1>
            <p className="text-sm text-muted">
              {month.label} · {user.plan === "pro" ? "Pro" : "Free"} plan
            </p>
          </div>
          <ResetDemoButton />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Transactions"
                value={`${facts.txnCountThisMonth}`}
                sub={
                  user.plan === "pro"
                    ? "no cap on Pro"
                    : `of ${facts.freeTxnCap} on Free · ${facts.remainingOnFree} left`
                }
                tone={
                  user.plan === "free" && facts.atCap
                    ? "bad"
                    : user.plan === "free" && facts.remainingOnFree <= 3
                      ? "agent"
                      : "plain"
                }
              />
              <Stat label="Spent" value={formatPaise(spent)} sub="this month" />
              <Stat
                label="Recurring"
                value={`${facts.recurringCount}`}
                sub={
                  facts.showsRecurringDetail
                    ? "named below"
                    : "Free shows the count only"
                }
                tone={user.plan === "free" && facts.recurringCount > 0 ? "agent" : "plain"}
              />
            </div>

            {user.plan === "free" && facts.atCap && (
              <p className="rounded-lg border border-line bg-agent-tint px-4 py-3 text-sm">
                You have used all {facts.freeTxnCap} Free transactions for{" "}
                {month.label}. The next one will not be saved until you upgrade.
              </p>
            )}

            {facts.showsRecurringDetail && facts.recurringCandidates.length > 0 && (
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
            )}

            <section className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">
                  Transactions · {month.label}
                </h2>
                {user.plan === "pro" && (
                  <a
                    href="/api/transactions/export"
                    className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-brand-tint hover:text-ink"
                  >
                    Export CSV
                  </a>
                )}
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs uppercase tracking-wide text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 font-medium">Category</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-muted tabular">
                          {row.occurredOn}
                        </td>
                        <td className="px-4 py-2">{row.merchant}</td>
                        <td className="px-4 py-2 text-muted">{row.category}</td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {formatPaise(row.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hidden > 0 && (
                <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                  Showing {visible.length} of {rows.length}. Free shows your most
                  recent {facts.freeTxnCap} transactions a month; the other{" "}
                  {hidden} are on Pro.
                </p>
              )}
            </section>
          </div>

          <AgentPanel
            profile={{ name: user.name, email: user.email }}
            plan={user.plan}
          />
        </div>
      </div>
    );
  } catch (error) {
    return <SetupNotice error={error} />;
  }
}

function Stat({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "plain" | "bad" | "agent";
}) {
  const valueClass =
    tone === "bad" ? "text-bad" : tone === "agent" ? "text-agent" : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl tabular ${valueClass}`}>{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}
