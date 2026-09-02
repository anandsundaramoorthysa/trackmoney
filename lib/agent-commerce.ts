import { eq } from "drizzle-orm";

import { logAgentEvent } from "@/lib/audit";
import { consumeChallenge, issueChallenge } from "@/lib/challenges";
import { db } from "@/lib/db";
import { planConfig, users } from "@/lib/db/schema";
import { checkMandate, consumeMandate, releaseMandate } from "@/lib/mandates";
import { formatPaise } from "@/lib/money";
import { createProUpgradeOrder } from "@/lib/razorpay";
import { modalityOf } from "@/lib/modality";
import { sign, type SignedAssertion } from "@/lib/signing";

/**
 * Buying as a machine, once, for every transport that offers it.
 *
 * There are two ways in now — the REST endpoint an x402-shaped buyer expects,
 * and an MCP server an assistant can be pointed at directly. They must not be
 * two implementations of the same rules, because two implementations of a rule
 * is one implementation and one liability: the second copy is where the gate
 * quietly stops matching.
 *
 * So the rules live here and the transports only translate. A REST caller gets
 * status codes, an MCP caller gets tool content, and neither decides anything.
 */

/**
 * Every way a purchase can be refused, as one list.
 *
 * This is a value rather than a bare type because the catalogue publishes it,
 * and a published vocabulary that drifts from the code is worse than an
 * unpublished one: a buyer branching on `refusedBecause` would be branching on
 * strings we had quietly stopped sending. Exporting the array means the
 * documentation is generated from the same source the refusals come from, and
 * a test asserts the two still agree.
 *
 * The names are namespaced on purpose. "unknown" alone never said unknown
 * what — a challenge and a mandate can both be unrecognised, for entirely
 * different reasons and with different fixes.
 */
export const PURCHASE_REFUSALS = [
  "no_product",
  "above_buyer_limit",
  "challenge_unknown",
  "challenge_used",
  "challenge_expired",
  "challenge_wrong_product",
  "mandate_unknown",
  "mandate_used",
  "mandate_expired",
  "mandate_wrong_product",
  "mandate_amount_exceeds",
  "mandate_race",
  "no_account",
  "already_pro",
  "razorpay_error",
] as const;

export type PurchaseRefusal = (typeof PURCHASE_REFUSALS)[number];

/**
 * What this merchant asserts about one purchase.
 *
 * AP2 calls this the Cart Mandate, and calls it the operationally important
 * one: the intent said what a person wanted, and this says what they are
 * actually being charged for, bound by the merchant rather than asserted by the
 * agent that wants the sale. Signing it means a buyer can keep it and later
 * show what the terms were without taking our word for it afterwards.
 */
export type CartMandate = {
  type: "trackmoney.cart-mandate/1";
  orderId: string;
  productId: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  processor: "razorpay";
  mode: "test";
  /** Which intent this cart satisfies, so the pair can be reconciled. */
  mandateId: string;
  /** Whether a person was present, in AP2's sense. */
  modality: string;
  issuedAt: string;
  settlement: string;
};

export type PurchaseResult =
  | {
      ok: true;
      orderId: string;
      amountMinor: number;
      currency: string;
      keyId: string;
      reused: boolean;
      buyerId: string;
      cart: SignedAssertion<CartMandate> | { payload: CartMandate };
    }
  | { ok: false; refusedBecause: PurchaseRefusal; message: string; priceMinor?: number };

/** The terms a buyer is told when it arrives with nothing. */
export async function purchaseTerms(productId = "pro") {
  const [product] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, productId as "free" | "pro"))
    .limit(1);

  const challenge = await issueChallenge({
    productId,
    amountPaise: product?.pricePaise ?? 0,
  });

  return {
    scheme: "trackmoney-mandate",
    protocol: "x402-style",
    productId,
    amountMinor: product?.pricePaise ?? null,
    currency: "INR",
    minorUnit: "paise",
    resource: "/api/agent-commerce/orders",
    authorisationEndpoint: "/billing",
    description:
      "A purchase mandate, issued by the account holder, presented as a bearer token, together with this nonce echoed in X-Payment-Challenge.",
    nonceHeader: "X-Payment-Challenge",
    nonce: challenge.nonce,
    expiresInSeconds: challenge.expiresInSeconds,
  };
}

/**
 * Every gate, in the order they have to run.
 *
 * The ordering is not cosmetic. The buyer's own ceiling is checked before
 * anything is spent, because refusing an over-budget purchase must not cost the
 * buyer its mandate. The challenge is spent before the mandate, and the mandate
 * before the order, so a race loses at the earliest possible point rather than
 * halfway through a purchase.
 */
export async function purchaseAsAgent(input: {
  token: string;
  productId: string;
  maxAmountMinor?: number;
  nonce: string;
}): Promise<PurchaseResult> {
  const [product] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, input.productId as "free" | "pro"))
    .limit(1);

  if (!product || product.pricePaise <= 0) {
    return {
      ok: false,
      refusedBecause: "no_product",
      message: `No purchasable product with id "${input.productId}".`,
    };
  }

  // The buyer's own ceiling, honoured as documented, and checked before
  // anything is consumed.
  if (input.maxAmountMinor !== undefined) {
    if (!Number.isInteger(input.maxAmountMinor) || input.maxAmountMinor <= 0) {
      return {
        ok: false,
        refusedBecause: "above_buyer_limit",
        message: "maxAmountMinor must be a positive whole number of paise.",
      };
    }
    if (product.pricePaise > input.maxAmountMinor) {
      return {
        ok: false,
        refusedBecause: "above_buyer_limit",
        message: `This product costs ${product.pricePaise} paise, above the ${input.maxAmountMinor} you allowed.`,
        priceMinor: product.pricePaise,
      };
    }
  }

  const challenge = await consumeChallenge(input.nonce, input.productId);
  if (!challenge.ok) {
    return {
      ok: false,
      refusedBecause: `challenge_${challenge.reason}` as PurchaseRefusal,
      message:
        challenge.reason === "used"
          ? "That payment challenge has already been spent. Request a new one."
          : challenge.reason === "expired"
            ? "That payment challenge has expired. Request a new one."
            : challenge.reason === "wrong_product"
              ? "That payment challenge was issued for a different product."
              : "A payment challenge is required. Ask for the terms first.",
    };
  }

  const check = await checkMandate({
    token: input.token,
    productId: input.productId,
    pricePaise: product.pricePaise,
  });

  if (!check.ok) {
    return {
      ok: false,
      refusedBecause: `mandate_${check.reason}` as PurchaseRefusal,
      message: check.message,
    };
  }

  const [buyer] = await db
    .select()
    .from(users)
    .where(eq(users.id, check.mandate.userId))
    .limit(1);

  if (!buyer) {
    return {
      ok: false,
      refusedBecause: "no_account",
      message: "That account no longer exists.",
    };
  }

  // Spent before the order is created: two buyers racing the same token would
  // otherwise both pass the check above.
  if (!(await consumeMandate(check.mandate.id))) {
    return {
      ok: false,
      refusedBecause: "mandate_race",
      message: "That mandate was spent by another request.",
    };
  }

  await logAgentEvent({
    userId: buyer.id,
    type: "intent",
    explanation: `An AI buyer presented a mandate for ${formatPaise(product.pricePaise)} of "${input.productId}". The mandate was issued by the account holder and is now spent.`,
    meta: {
      intent: "affirmative",
      via: "purchase_mandate",
      mandateId: check.mandate.id,
      purpose: check.mandate.purpose,
      maxAmountPaise: check.mandate.maxAmountPaise,
    },
  });

  const result = await createProUpgradeOrder(buyer, { initiatedBy: "ai_buyer" });

  if (!result.ok) {
    // Only give the authorisation back for a transport failure. An account
    // already on Pro is a settled answer, not a retryable one.
    if (result.rule !== "already_pro") {
      await releaseMandate(check.mandate.id);
    }

    return {
      ok: false,
      refusedBecause: result.rule === "already_pro" ? "already_pro" : "razorpay_error",
      message: result.message,
    };
  }

  const cart = sign<CartMandate>({
    type: "trackmoney.cart-mandate/1",
    orderId: result.orderId,
    productId: input.productId,
    amountMinor: result.amountPaise,
    currency: result.currency,
    merchant: "TrackMoney",
    processor: "razorpay",
    mode: "test",
    mandateId: check.mandate.id,
    modality: modalityOf("ai_buyer"),
    issuedAt: new Date().toISOString(),
    settlement:
      "A person authorises this order in Razorpay's own checkout. This merchant never captures payment.",
  });

  return {
    ok: true,
    orderId: result.orderId,
    amountMinor: result.amountPaise,
    currency: result.currency,
    keyId: result.keyId,
    reused: result.reused,
    buyerId: buyer.id,
    cart,
  };
}

/** How a refusal maps to HTTP, kept with the refusals rather than in a route. */
export function httpStatusFor(refusal: PurchaseRefusal): number {
  if (refusal === "no_product" || refusal === "no_account") return 404;
  if (refusal.startsWith("challenge_")) return 402;
  if (refusal === "mandate_unknown") return 401;
  if (refusal === "above_buyer_limit") return 409;
  if (refusal === "razorpay_error") return 502;
  return 403;
}
