import { and, desc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { computeUsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { istMonthRange } from "@/lib/time";
import { CATEGORIES } from "@/lib/transactions";
import {
  addTransactionAction,
  deleteTransactionAction,
} from "@/lib/transactions-actions";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    deleted?: string;
    capped?: string;
    imported?: string;
    skipped?: string;
    failed?: string;
  }>;
}) {
  const user = await requireUser();
  const facts = await computeUsageFacts(user);
  const month = istMonthRange();
  const { error, added, deleted, capped, imported, skipped, failed } =
    await searchParams;

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
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));

  const visible =
    facts.visibleTxnCap === null ? rows : rows.slice(0, facts.visibleTxnCap);
  const hidden = rows.length - visible.length;
  const today = month.start.slice(0, 8) + String(new Date().getDate()).padStart(2, "0");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Transactions</h1>
        <p className="mt-1 text-sm text-muted">
          {month.label} · {facts.txnCountThisMonth} logged
          {user.plan === "free" &&
            ` · ${facts.remainingOnFree} of ${facts.freeTxnCap} left on Free`}
        </p>
        </div>
        <Link
          href="/transactions/import"
          className="rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:bg-brand-tint"
        >
          Import CSV{user.plan === "free" ? " (Pro)" : ""}
        </Link>
      </div>

      {capped && (
        <div className="rounded-lg border border-bad/30 bg-agent-tint px-4 py-3 text-sm">
          <p className="font-medium text-bad">
            That transaction was not saved.
          </p>
          <p className="mt-1 text-muted">
            The Free plan allows {capped} transactions a month and you have used
            them all for {month.label}.{" "}
            <Link href="/billing" className="text-brand hover:underline">
              Upgrade to Pro
            </Link>{" "}
            for unlimited, or ask the assistant on the dashboard.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-bad/30 bg-agent-tint px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      {added && (
        <p className="rounded-lg border border-line bg-brand-tint px-4 py-3 text-sm">
          Transaction added.
        </p>
      )}
      {deleted && (
        <p className="rounded-lg border border-line bg-brand-tint px-4 py-3 text-sm">
          Transaction deleted.
        </p>
      )}
      {imported !== undefined && (
        <p className="rounded-lg border border-line bg-brand-tint px-4 py-3 text-sm">
          {imported} imported
          {Number(skipped ?? 0) > 0 && `, ${skipped} skipped as duplicates`}
          {Number(failed ?? 0) > 0 && `, ${failed} could not be read`}.
        </p>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold">Add a transaction</h2>
        <form
          action={addTransactionAction}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs text-muted">Merchant</span>
            <input
              name="merchant"
              required
              maxLength={80}
              placeholder="Swiggy"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Amount (₹)</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="249.50"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Category</span>
            <select
              name="category"
              defaultValue="Food & Drink"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Date</span>
            <input
              name="occurredOn"
              type="date"
              required
              defaultValue={today}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Add transaction
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          {month.label}
        </h2>
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            Nothing logged this month yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2" />
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
                    <td className="px-4 py-2 text-right">
                      <form action={deleteTransactionAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-agent-tint hover:text-bad"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hidden > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Showing {visible.length} of {rows.length}. Free lists your most
            recent {facts.freeTxnCap} a month; the other {hidden} are on Pro.
          </p>
        )}
      </section>
    </div>
  );
}
