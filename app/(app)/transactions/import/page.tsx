import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import {
  commitImportAction,
  loadImportBatch,
  previewImportAction,
} from "@/lib/import-actions";
import { MAX_IMPORT_ROWS } from "@/lib/import-encode";
import { formatPaise } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; batch?: string }>;
}) {
  const user = await requireUser();
  const { error, batch: batchId } = await searchParams;

  if (user.plan !== "pro") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Import a statement
        </h1>
        <p className="max-w-xl text-sm text-muted">
          Importing a CSV is part of Pro. On Free you can add transactions one at
          a time from the{" "}
          <Link href="/transactions" className="text-brand hover:underline">
            Transactions
          </Link>{" "}
          page.
        </p>
        <Link
          href="/billing"
          className="inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          See Pro
        </Link>
      </div>
    );
  }

  const batch = batchId ? await loadImportBatch(user.id, batchId) : null;
  const rows = batch?.rows ?? [];
  const ignored = batch?.ignored ?? 0;
  const duplicates = rows.filter((row) => row.duplicate).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Import a statement
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A CSV with a date column and an amount column. Debit and credit columns
          are understood too; credits are left out, because TrackMoney records
          spending. Dates are read day-first.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-bad/30 bg-agent-tint px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <form action={previewImportAction} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">CSV file</span>
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-2 file:text-sm file:text-ink hover:file:bg-brand-tint"
              />
              <span className="mt-1 block text-xs text-muted">
                Up to {MAX_IMPORT_ROWS} rows and 2 MB. Nothing is saved until you
                confirm the preview.
              </span>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Read the file
            </button>
          </form>
        </section>
      ) : (
        <form action={commitImportAction} className="space-y-4">
          <input type="hidden" name="batchId" value={batchId} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-lg border border-line bg-surface px-3 py-1.5">
              <span className="text-muted">Rows read </span>
              <span className="font-mono tabular">{rows.length}</span>
            </span>
            {duplicates > 0 && (
              <span className="rounded-lg border border-agent/40 bg-agent-tint px-3 py-1.5">
                <span className="text-muted">Already have </span>
                <span className="font-mono tabular text-agent">{duplicates}</span>
              </span>
            )}
            {ignored > 0 && (
              <span className="rounded-lg border border-line bg-surface px-3 py-1.5">
                <span className="text-muted">Not spending rows </span>
                <span className="font-mono tabular">{ignored}</span>
              </span>
            )}
          </div>

          <p className="text-sm text-muted">
            Rows you already have are unticked. Tick one to import it anyway.
          </p>

          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="max-h-[460px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Import</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Merchant</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={`${row.occurredOn}-${row.merchant}-${index}`}
                      className={`border-b border-line/60 last:border-0 ${
                        row.duplicate ? "bg-agent-tint/40" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          name="include"
                          value={index}
                          defaultChecked={!row.duplicate}
                          aria-label={`Import ${row.merchant} on ${row.occurredOn}`}
                        />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted tabular">
                        {row.occurredOn}
                      </td>
                      <td className="px-4 py-2">
                        {row.merchant}
                        {row.duplicate && (
                          <span className="ml-2 rounded-full bg-agent-tint px-2 py-0.5 text-[11px] text-agent">
                            already have this
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted">
                        {row.category}
                        {/* A category that appears with no explanation is one
                            nobody trusts, and the point of a preview is to be
                            able to disagree before anything is written. */}
                        {row.matchedPattern && (
                          <span className="ml-1.5 whitespace-nowrap text-xs text-brand">
                            rule: {row.matchedPattern}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular">
                        {formatPaise(row.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Import ticked rows
            </button>
            <Link
              href="/transactions/import"
              className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium transition-colors hover:bg-brand-tint"
            >
              Start over
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
