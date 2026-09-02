/**
 * The categories a transaction can have.
 *
 * Kept in a module of its own because both the server and the browser need the
 * list — the add form, the import preview, the agent's draft card — and
 * `lib/transactions.ts` reaches for the database on import. Pulling this from
 * there dragged the Postgres driver into the client bundle, which fails the
 * build with "can't resolve 'net'" and would have shipped a database driver to
 * the browser if it had not.
 *
 * A fixed list rather than a table: the point of the breakdown is comparing
 * like with like month to month, and free-text categories make that impossible
 * within a week.
 */
export const CATEGORIES = [
  "Food & Drink",
  "Groceries",
  "Transport",
  "Shopping",
  "Utilities",
  "Entertainment",
  "Health",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
