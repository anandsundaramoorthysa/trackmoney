import Link from "next/link";

import { requireUser } from "@/lib/auth/guard";
import { listRules, MAX_RULES } from "@/lib/category-rules";
import { MATCH_TYPES } from "@/lib/categorize";
import {
  createRuleAction,
  deleteRuleAction,
} from "@/lib/category-rules-actions";
import { CATEGORIES } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** How each match type reads to somebody who has not read the code. */
const MATCH_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
  word: "contains the word",
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string; deleted?: string }>;
}) {
  const user = await requireUser();
  const [rules, params] = await Promise.all([listRules(user.id), searchParams]);

  const ordered = [...rules].sort(
    (a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Category rules
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A statement almost never says what a charge was for. These rules read
          the merchant name and file the row for you, so an import arrives
          sorted instead of arriving as a hundred rows of “Other”. They run on
          import only, and the preview always shows what they decided before
          anything is saved.
        </p>
      </div>

      {params.error && (
        <p className="rounded-lg border border-bad/30 bg-agent-tint px-4 py-3 text-sm text-bad">
          {params.error}
        </p>
      )}
      {params.added && (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
          Rule added. It applies to the next import, not to rows already saved.
        </p>
      )}
      {params.deleted && (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
          Rule deleted.
        </p>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold">Add a rule</h2>
        <form
          action={createRuleAction}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs text-muted">
              When the merchant
            </span>
            <select
              name="matchType"
              defaultValue="contains"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MATCH_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">This text</span>
            <input
              name="pattern"
              required
              maxLength={80}
              placeholder="swiggy"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">File it as</span>
            <select
              name="category"
              defaultValue="Food & Drink"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Add rule
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          Your rules · {rules.length} of {MAX_RULES}
        </h2>

        {ordered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">
            <p>No rules yet.</p>
            <p className="mt-1">
              Import a statement and the preview will show every row as “Other”
              — a rule for the merchants you recognise turns that into a
              breakdown worth reading.{" "}
              <Link
                href="/transactions/import"
                className="text-brand hover:underline"
              >
                Import a statement
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {ordered.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span>
                  Merchant {MATCH_LABELS[rule.matchType] ?? rule.matchType}{" "}
                  <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs">
                    {rule.pattern}
                  </code>{" "}
                  → <span className="font-medium">{rule.category}</span>
                </span>

                <form action={deleteRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-bad/40 hover:text-bad"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
