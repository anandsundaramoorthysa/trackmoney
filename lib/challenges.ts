import crypto from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { paymentChallenges } from "@/lib/db/schema";

/**
 * The nonce that makes a 402 mean something.
 *
 * x402 answers an unpaid request with terms and a nonce, and the buyer's next
 * request quotes that nonce back. The point is binding: an answer belongs to
 * one specific demand, so a captured exchange cannot be replayed and a buyer
 * cannot be tricked into paying against a demand it never saw.
 *
 * The mandate already resists replay on its own — it is single-use and
 * expiring — so this is a second, independent lock rather than the only one.
 * That is deliberate. The two fail differently: a mandate is issued in advance
 * by a person, a challenge is issued in the moment by the server, and an attack
 * that defeats one has no purchase on the other.
 */

/** Long enough for a slow agent, short enough that a leaked one is stale. */
export const CHALLENGE_TTL_SECONDS = 300;

export async function issueChallenge(input: {
  productId: string;
  amountPaise: number;
}): Promise<{ nonce: string; expiresInSeconds: number }> {
  // Yesterday's challenges are of no use to anyone, and this is the only
  // moment the table is touched often enough to be worth sweeping.
  await db
    .delete(paymentChallenges)
    .where(lt(paymentChallenges.expiresAt, new Date(Date.now() - 3_600_000)));

  const nonce = crypto.randomBytes(18).toString("base64url");

  await db.insert(paymentChallenges).values({
    nonce,
    productId: input.productId,
    amountPaise: input.amountPaise,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
  });

  return { nonce, expiresInSeconds: CHALLENGE_TTL_SECONDS };
}

export type ChallengeCheck =
  | { ok: true }
  | { ok: false; reason: "unknown" | "used" | "expired" | "wrong_product" };

/**
 * Spend a challenge, or say why it cannot be spent.
 *
 * The update is the check: marking it used is conditional on it still being
 * unused, so two requests arriving together with the same nonce cannot both
 * win. Reading first and writing second would leave exactly the replay window
 * this exists to close.
 */
export async function consumeChallenge(
  nonce: string,
  productId: string,
): Promise<ChallengeCheck> {
  if (!nonce) return { ok: false, reason: "unknown" };

  const claimed = await db
    .update(paymentChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(paymentChallenges.nonce, nonce),
        eq(paymentChallenges.productId, productId),
        isNull(paymentChallenges.usedAt),
        // Postgres compares against its own clock here rather than ours.
        sql`${paymentChallenges.expiresAt} > now()`,
      ),
    )
    .returning({ nonce: paymentChallenges.nonce });

  if (claimed.length > 0) return { ok: true };

  // It did not apply. Say which of the four reasons it was, because "no" on
  // its own is not something a buyer can act on.
  const [row] = await db
    .select()
    .from(paymentChallenges)
    .where(eq(paymentChallenges.nonce, nonce))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: false, reason: "wrong_product" };
}

/** Only for tests and the seed: nothing in the app deletes these by hand. */
export async function clearChallenges(): Promise<void> {
  await db
    .delete(paymentChallenges)
    .where(or(isNull(paymentChallenges.usedAt), lt(paymentChallenges.createdAt, new Date())));
}
