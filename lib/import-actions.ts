"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { transactionDedupKey } from "@/lib/dedup";
import { parseTransactionsCsv } from "@/lib/csv-import";
import {
  encodeRow,
  MAX_IMPORT_ROWS,
  type PreviewRow,
} from "@/lib/import-encode";
import { decodeRow } from "@/lib/import-encode";
import { addTransaction } from "@/lib/transactions";

/** Every refusal comes back on the import page, next to the file input. */
function fail(message: string): never {
  redirect(`/transactions/import?error=${encodeURIComponent(message)}`);
}

/**
 * Statement import — PLAN.md §10.4.
 *
 * Two steps, both server-rendered. The upload is parsed and shown back as a
 * preview with plain checkboxes; nothing is written until the second form is
 * submitted. Duplicates are unticked in advance rather than hidden, because
 * re-importing an overlapping statement is the normal case and the person doing
 * it should be able to see what was skipped and overrule it.
 */

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
      and(
        eq(transactions.userId, user.id),
        inArray(transactions.dedupKey, keys),
      ),
    );
  const known = new Set(existing.map((row) => row.dedupKey));

  // A file can also duplicate itself.
  const seen = new Set<string>();
  const preview: PreviewRow[] = parsed.rows.map((row, index) => {
    const key = keys[index];
    const duplicate = known.has(key) || seen.has(key);
    seen.add(key);
    return { ...row, duplicate };
  });

  const payload = Buffer.from(
    JSON.stringify(preview.map(encodeRow)),
    "utf8",
  ).toString("base64url");

  redirect(`/transactions/import?stage=preview&ignored=${parsed.ignored}&rows=${payload}`);
}

export async function commitImportAction(form: FormData): Promise<void> {
  const user = await requireUser();
  if (user.plan !== "pro") fail("Importing a statement is part of Pro.");

  const chosen = form.getAll("include").map(String);
  if (chosen.length === 0) {
    fail("Nothing was ticked, so nothing was imported.");
  }

  let imported = 0;
  let skipped = 0;
  let failedRows = 0;

  for (const encoded of chosen) {
    const row = decodeRow(encoded);
    if (!row) {
      failedRows += 1;
      continue;
    }

    const result = await addTransaction(user, { ...row, source: "import" });
    if (result.ok) imported += 1;
    else if (result.reason === "duplicate") skipped += 1;
    else failedRows += 1;
  }

  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/insights");

  redirect(
    `/transactions?imported=${imported}&skipped=${skipped}&failed=${failedRows}`,
  );
}
