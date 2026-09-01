import crypto from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { purchaseMandates, type PurchaseMandate } from "@/lib/db/schema";

/**
 * Purchase mandates
 *
 * The human flow gates a money action on a person clicking. An AI buyer has
 * nobody to click, so the authority has to be granted in advance and carried:
 * a scoped, expiring, single-use token naming what may be bought and the most
 * it may cost.
 *
 * The buyer never holds authority of its own. It holds something a person
 * signed, which is a different thing and the only version of agent-to-agent
 * commerce worth defending.
 */

export const MANDATE_TTL_MINUTES = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueMandate(input: {
  userId: string;
  productId: string;
  maxAmountPaise: number;
  purpose?: string;
}): Promise<{ token: string; expiresAt: Date }> {
  // One live mandate at a time: two would be two ways to spend.
  await db
    .update(purchaseMandates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(purchaseMandates.userId, input.userId),
        isNull(purchaseMandates.usedAt),
      ),
    );

  const token = `tmm_${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + MANDATE_TTL_MINUTES * 60_000);

  await db.insert(purchaseMandates).values({
    userId: input.userId,
    productId: input.productId,
    maxAmountPaise: input.maxAmountPaise,
    purpose: input.purpose?.slice(0, 200) ?? null,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export type MandateCheck =
  | { ok: true; mandate: PurchaseMandate }
  | {
      ok: false;
      reason: "unknown" | "used" | "expired" | "wrong_product" | "amount_exceeds_mandate";
      message: string;
    };

export async function checkMandate(input: {
  token: string;
  productId: string;
  pricePaise: number;
}): Promise<MandateCheck> {
  const [mandate] = await db
    .select()
    .from(purchaseMandates)
    .where(eq(purchaseMandates.tokenHash, hashToken(input.token)))
    .limit(1);

  if (!mandate) {
    return { ok: false, reason: "unknown", message: "That mandate is not recognised." };
  }
  if (mandate.usedAt) {
    return {
      ok: false,
      reason: "used",
      message: "That mandate has already been spent. Mandates authorise one purchase.",
    };
  }
  if (mandate.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: `That mandate has expired. Mandates last ${MANDATE_TTL_MINUTES} minutes.`,
    };
  }
  if (mandate.productId !== input.productId) {
    return {
      ok: false,
      reason: "wrong_product",
      message: `That mandate authorises "${mandate.productId}", not "${input.productId}".`,
    };
  }

  // The price is the catalogue's, never the buyer's. The mandate only says how
  // much the account holder was willing to allow.
  if (input.pricePaise > mandate.maxAmountPaise) {
    return {
      ok: false,
      reason: "amount_exceeds_mandate",
      message: "The price is higher than this mandate allows.",
    };
  }

  return { ok: true, mandate };
}

/** Spent at the moment an order is created, not when it is paid. */
export async function consumeMandate(id: string): Promise<boolean> {
  const consumed = await db
    .update(purchaseMandates)
    .set({ usedAt: new Date() })
    .where(and(eq(purchaseMandates.id, id), isNull(purchaseMandates.usedAt)))
    .returning({ id: purchaseMandates.id });

  return consumed.length > 0;
}

/**
 * Hand a mandate back when the purchase it was spent on did not happen.
 *
 * The mandate is spent *before* the order is created, so two buyers racing the
 * same token cannot both succeed. The cost of that ordering is that a failure
 * downstream — Razorpay unreachable, say — would otherwise burn the
 * authorisation and leave the account holder to issue another for a purchase
 * that never took place.
 */
export async function releaseMandate(id: string): Promise<void> {
  await db
    .update(purchaseMandates)
    .set({ usedAt: null })
    .where(eq(purchaseMandates.id, id));
}
