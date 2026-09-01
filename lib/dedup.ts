import crypto from "node:crypto";

/**
 * Transaction fingerprint
 *
 * Re-importing a statement that overlaps an earlier one is the normal case, so
 * the same charge must not land twice. Two rows collide when they share an
 * owner, a day, an amount and a merchant that normalises to the same thing.
 *
 * The merchant is normalised because the same payment is rarely spelled the
 * same way twice across exports — case, punctuation and spacing all drift.
 * Truncating limits how much of a long narration has to agree.
 *
 * This value is written to a column with a unique index, so the database
 * enforces it. A rule the database keeps cannot be bypassed by a second code
 * path that forgets to ask.
 */
export function normaliseMerchant(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function transactionDedupKey(input: {
  userId: string;
  occurredOn: string;
  amountPaise: number;
  merchant: string;
}): string {
  const raw = [
    input.userId,
    input.occurredOn,
    String(input.amountPaise),
    normaliseMerchant(input.merchant),
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
