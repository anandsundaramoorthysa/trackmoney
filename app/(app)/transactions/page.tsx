import { and, desc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { computeUsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { istMonthRange, istToday, monthRangeOf, resolveMonth } from "@/lib/time";
import { CATEGORIES, monthsWithActivity } from "@/lib/transactions";
import { EmptyMonthNotice, MonthNav } from "@/components/MonthNav";
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
    why?: string;
    failed?: string;
    month?: string;
  }>;
}) {
  const user = await requireUser();
  const facts = await computeUsageFacts(user);
  const params = await searchParams;
  const { error, added, deleted, capped, imported, skipped, failed, why } =
    params;

  /**
   * Which month is on screen.
   *
   * This page was pinned to the current one, so a statement imported from an
   * earlier month wrote its rows and then showed none of them. The month is now
   * part of the address, which also means a reload or a shared link lands in
   * the same place.
   */
  const currentMonth = istMonthRange().start.slice(0, 7);
  const shownMonth = resolveMonth(params.month);
  const month = monthRangeOf(shownMonth);
  const isCurrentMonth = shownMonth === currentMonth;
  const activity = await monthsWithActivity(user.id);

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

  // The Free row limit describes this month's allowance, so it has nothing to
  // say about a month already in the past — those rows are all history.
  const visible =
    facts.visibleTxnCap === null || !isCurrentMonth
      ? rows
      : rows.slice(0, facts.visibleTxnCap);
  const hidden = rows.length - visible.length;
  // The server's own clock is UTC in production, so composing a date from it
  // put the form a day behind for anyone adding a transaction late in the
  // evening IST — against a month boundary that is computed in IST.
  const today = istToday();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Transactions</h1>
        <p className="mt-1 text-sm text-muted">
          {/* The count belongs to the month on screen. Reading the current
              month's tally under a past month's heading would be a plain
              untruth, and the allowance only means anything for this one. */}
          {month.label} · {rows.length} logged
          {user.plan === "free" &&
            isCurrentMonth &&
            ` · ${facts.remainingOnFree} of ${facts.freeTxnCap} left on Free`}
        </p>
        </div>
        {/*
          Wraps, because it did not.

          The month arrows and the two CSV buttons came to 385px against a
          375px phone, and with nothing allowed to wrap the excess pushed the
          document wider than the viewport — so the entire page scrolled
          sideways and "Export CSV" was clipped at the edge. Wrapping puts the
          buttons on their own line instead; min-w-0 stops the month control
          refusing to shrink and reinstating the same overflow.
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <MonthNav
            month={shownMonth}
            currentMonth={currentMonth}
            earliestMonth={activity.earliest}
            basePath="/transactions"
          />
          {user.plan === "pro" && rows.length > 0 && (
            <a
              href={`/api/transactions/export?month=${shownMonth}`}
              className="rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:bg-brand-tint"
            >
              Export CSV
            </a>
          )}
          <Link
            href="/transactions/import"
            className="rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:bg-brand-tint"
          >
            Import CSV{user.plan === "free" ? " (Pro)" : ""}
          </Link>
        </div>
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
            for unlimited, or ask the assistant.
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
          {/*
            Skipped and failed are different things, and saying so is the
            point. A row dated next week is refused on policy — it reads
            perfectly well — and reporting it as unreadable blamed the file
            for a rule this app was enforcing. "Could not be read" now means
            unparseable and nothing else.
          */}
          {Number(skipped ?? 0) > 0 &&
            (why ? `, ${skipped} skipped (${why})` : `, ${skipped} skipped`)}
          {Number(failed ?? 0) > 0 && `, ${failed} could not be read`}.
        </p>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold">Add a transaction</h2>
        <form
          action={addTransactionAction}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {/* So the outcome comes back to the month being looked at, not to
              whatever month today happens to fall in. */}
          <input type="hidden" name="month" value={shownMonth} />
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
          activity.latest && activity.latest !== shownMonth ? (
            <div className="p-4">
              <EmptyMonthNotice
                month={shownMonth}
                nearest={activity.latest}
                basePath="/transactions"
              />
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-muted">
              Nothing logged in {month.label} yet.
            </p>
          )
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
                        <input type="hidden" name="month" value={shownMonth} />
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
