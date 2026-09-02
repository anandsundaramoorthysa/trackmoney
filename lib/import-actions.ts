"use server";

import { and, eq, inArray, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guard";
import { parseTransactionsCsv } from "@/lib/csv-import";
import { db } from "@/lib/db";
import { importBatches, transactions } from "@/lib/db/schema";
import { transactionDedupKey } from "@/lib/dedup";
import { categoryFor } from "@/lib/categorize";
import { listRules } from "@/lib/category-rules";
import { decodeRow, encodeRow, MAX_IMPORT_ROWS, type PreviewRow } from "@/lib/import-encode";
import {
  addTransaction,
  refusalFor,
  ROW_REFUSAL_LABELS,
} from "@/lib/transactions";

/**
 * Statement import
 *
 * Two steps, both server-rendered. The upload is parsed and shown back as a
 * preview with plain checkboxes; nothing is written until the second form is
 * submitted. Duplicates are unticked in advance rather than hidden, because
 * re-importing an overlapping statement is the normal case and the person doing
 * it should be able to see what was skipped and overrule it.
 *
 * The parsed rows are held in `import_batches` between the two steps. They used
 * to be encoded into the URL, which failed the moment anyone imported a real
 * statement — three hundred rows come to roughly 28 KB and Node refuses a
 * request line over 16 KB. Keeping them server-side also means the commit
 * writes what was parsed rather than whatever the form posted back.
 */

/** Every refusal comes back on the import page, next to the file input. */
function fail(message: string): never {
  redirect(`/transactions/import?error=${encodeURIComponent(message)}`);
}

export async function previewImportAction(form: FormData): Promise<void> {
  const user = await requireUser();
  if (user.plan !== "pro") fail("Importing a statement is part of Pro.");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose a CSV file.");
  if (file.size > 2_000_000) fail("That file is larger than 2 MB.");

  const parsed = parseTransactionsCsv(await file.text());
  if (parsed.problem) fail(parsed.problem);
  if (parsed.rows.length === 0) {
    fail("No spending rows were found in that file.");
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    fail(`That file has ${parsed.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}.`);
  }

  // One query for the whole batch rather than one per row.
  const keys = parsed.rows.map((row) =>
    transactionDedupKey({ userId: user.id, ...row }),
  );
  const existing = await db
    .select({ dedupKey: transactions.dedupKey })
    .from(transactions)
    .where(
      and(eq(transactions.userId, user.id), inArray(transactions.dedupKey, keys)),
    );
  const known = new Set(existing.map((row) => row.dedupKey));

  /**
   * The account's own rules decide the category before anything is written.
   *
   * A statement almost never carries a usable category column, so without this
   * every imported row arrived as "Other" and the breakdown — one of the things
   * Pro is sold on — said nothing. The rule that matched is carried through to
   * the preview so the page can show why a row was filed where it was, and the
   * person can disagree before committing rather than after.
   */
  const rules = await listRules(user.id);

  // A file can also duplicate itself.
  const seen = new Set<string>();
  const preview: PreviewRow[] = parsed.rows.map((row, index) => {
    const key = keys[index];
    const duplicate = known.has(key) || seen.has(key);
    seen.add(key);

    // The same rule the commit will apply, asked here so the two agree. A row
    // the commit would refuse must never be offered ticked.
    const refusal = refusalFor(row);

    // A category named by the file is the person's own data and outranks a
    // rule; rules exist to fill the silence, not to overrule a statement.
    const matched = row.category === "Other" ? categoryFor(rules, row.merchant) : null;

    return {
      ...row,
      category: matched?.category ?? row.category,
      matchedPattern: matched?.rule.pattern ?? null,
      duplicate,
      refusal,
    };
  });

  // Yesterday's abandoned previews are of no use to anyone.
  await db
    .delete(importBatches)
    .where(lt(importBatches.createdAt, new Date(Date.now() - 86_400_000)));

  const [batch] = await db
    .insert(importBatches)
    .values({
      userId: user.id,
      rows: preview.map(encodeRow),
      ignoredCount: parsed.ignored,
    })
    .returning({ id: importBatches.id });

  redirect(`/transactions/import?batch=${batch.id}`);
}

/** Reads a batch back, scoped to its owner. */
export async function loadImportBatch(
  userId: string,
  batchId: string,
): Promise<{ rows: PreviewRow[]; ignored: number } | null> {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
    .limit(1);

  if (!batch) return null;

  const rows = (batch.rows as string[])
    .map(decodeRow)
    .filter((row): row is PreviewRow => row !== null);

  return { rows, ignored: batch.ignoredCount };
}

export async function commitImportAction(form: FormData): Promise<void> {
  const user = await requireUser();
  if (user.plan !== "pro") fail("Importing a statement is part of Pro.");

  const batchId = String(form.get("batchId") ?? "");
  const batch = batchId ? await loadImportBatch(user.id, batchId) : null;
  if (!batch) {
    fail("That preview has expired. Upload the file again.");
  }

  // The form sends which rows to keep; the rows themselves come from the batch,
  // so a tampered form can change what is imported but never what it contains.
  const chosen = new Set(form.getAll("include").map((value) => Number(value)));
  if (chosen.size === 0) {
    fail("Nothing was ticked, so nothing was imported.");
  }

  let imported = 0;
  let skipped = 0;
  let failedRows = 0;
  /** Skipped rows, counted by why — "skipped" alone tells nobody anything. */
  const reasons = new Map<string, number>();

  const note = (reason: string) => {
    skipped += 1;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  };

  for (const [index, row] of batch.rows.entries()) {
    if (!chosen.has(index)) continue;

    /**
     * Three outcomes, not two.
     *
     * A row refused on policy is not a row that could not be read, and calling
     * it one blamed the file for a rule the app was enforcing. "Could not be
     * read" now means exactly one thing: unparseable.
     */
    const refusal = refusalFor(row);
    if (refusal) {
      note(ROW_REFUSAL_LABELS[refusal]);
      continue;
    }

    const result = await addTransaction(user, { ...row, source: "import" });
    if (result.ok) imported += 1;
    else if (result.reason === "duplicate") note("already recorded");
    else failedRows += 1;
  }

  await db.delete(importBatches).where(eq(importBatches.id, batchId));

  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/insights");

  // The reasons travel with the counts, so the page can name them rather than
  // reporting a bare number nobody can act on.
  const why = [...reasons.entries()]
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");

  redirect(
    `/transactions?imported=${imported}&skipped=${skipped}&failed=${failedRows}` +
      (why ? `&why=${encodeURIComponent(why)}` : ""),
  );
}
