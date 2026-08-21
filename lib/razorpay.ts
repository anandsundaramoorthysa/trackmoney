import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import Razorpay from "razorpay";

import { logAgentEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { payments, planConfig, users, type User } from "@/lib/db/schema";
import { formatPaise } from "@/lib/money";

/**
 * The one shared money function — PLAN.md §6.12 step 5.
 *
 * `createProUpgradeOrder` is the ONLY place in this codebase that creates a
 * Razorpay order. The billing page button calls it and the agent's
 * `createCheckoutOrder` tool calls it — the same function, the same arguments,
 * the same guards. The agent has no payment path of its own and therefore no
 * privilege a human clicking the button does not already have.
 *
 * Two of the five bounding rules live here rather than in the agent, because
 * they apply to every caller including a human:
 *   - rule 5: an account already on Pro cannot be charged again
 *   - rule 3: one open order per user (idempotency)
 *
 * The three consent-related rules live in the agent wrapper, since a human
 * clicking a button is self-evidently consenting. See lib/agent/tools.ts.
 */

export const RAZORPAY_CURRENCY = "INR";

let client: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay keys are missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.local.",
    );
  }

  if (!keyId.startsWith("rzp_test_")) {
    // PLAN.md §4: test mode only, everywhere, always.
    throw new Error(
      "Refusing to start: RAZORPAY_KEY_ID is not a test-mode key. TrackMoney is a demo and must never be pointed at live keys.",
    );
  }

  client ??= new Razorpay({ key_id: keyId, key_secret: keySecret });
  return client;
}

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      amountPaise: number;
      currency: string;
      keyId: string;
      /** True when an existing open order was returned instead of a new one. */
      reused: boolean;
    }
  | {
      ok: false;
      rule: "already_pro" | "razorpay_error";
      message: string;
    };

export async function createProUpgradeOrder(
  user: User,
  options: {
    initiatedBy: "agent" | "billing_page";
    conversationId?: string | null;
  },
): Promise<CreateOrderResult> {
  // Rule 5 — already on Pro. Applies to every caller.
  if (user.plan === "pro") {
    const message = "This account is already on Pro, so there is nothing to charge for.";
    await logAgentEvent({
      userId: user.id,
      conversationId: options.conversationId ?? null,
      type: "tool_refused",
      explanation: message,
      meta: { rule: "already_pro", initiatedBy: options.initiatedBy },
    });
    return { ok: false, rule: "already_pro", message };
  }

  const [pro] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, "pro"))
    .limit(1);

  if (!pro) {
    return {
      ok: false,
      rule: "razorpay_error",
      message: "plan_config has no pro row. Run `npm run db:seed`.",
    };
  }

  const keyId = process.env.RAZORPAY_KEY_ID!;

  // Rule 3 — one open order per user. A retry loop, a double-click or a model
  // calling the tool twice returns the same order rather than stacking up new
  // ones.
  const [existing] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, user.id), eq(payments.status, "created")))
    .limit(1);

  if (existing) {
    await logAgentEvent({
      userId: user.id,
      conversationId: options.conversationId ?? null,
      type: "checkout_created",
      explanation: `Reused the open ${formatPaise(existing.amountPaise)} order ${existing.razorpayOrderId} instead of creating a second one.`,
      meta: {
        rule: "one_open_order_per_user",
        reused: true,
        orderId: existing.razorpayOrderId,
        initiatedBy: options.initiatedBy,
      },
    });

    return {
      ok: true,
      orderId: existing.razorpayOrderId,
      amountPaise: existing.amountPaise,
      currency: RAZORPAY_CURRENCY,
      keyId,
      reused: true,
    };
  }

  try {
    const order = await getRazorpayClient().orders.create({
      amount: pro.pricePaise,
      currency: RAZORPAY_CURRENCY,
      receipt: `tm_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        plan: "pro",
        initiated_by: options.initiatedBy,
      },
    });

    await db.insert(payments).values({
      userId: user.id,
      razorpayOrderId: order.id,
      amountPaise: pro.pricePaise,
      status: "created",
      initiatedBy: options.initiatedBy,
    });

    await logAgentEvent({
      userId: user.id,
      conversationId: options.conversationId ?? null,
      type: "checkout_created",
      explanation: `Created a ${formatPaise(pro.pricePaise)} Razorpay test-mode order for the Pro upgrade. No money moves until the user authorises it in Razorpay's own checkout.`,
      facts: {
        pricePaise: pro.pricePaise,
        currency: RAZORPAY_CURRENCY,
      },
      meta: {
        orderId: order.id,
        initiatedBy: options.initiatedBy,
        sharedFunction: "createProUpgradeOrder",
      },
    });

    return {
      ok: true,
      orderId: order.id,
      amountPaise: pro.pricePaise,
      currency: RAZORPAY_CURRENCY,
      keyId,
      reused: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Razorpay order creation failed.";

    await logAgentEvent({
      userId: user.id,
      conversationId: options.conversationId ?? null,
      type: "checkout_result",
      explanation: `Could not create the Razorpay order: ${message}`,
      meta: { outcome: "order_creation_failed", initiatedBy: options.initiatedBy },
    });

    return { ok: false, rule: "razorpay_error", message };
  }
}

/**
 * Payment verification — PLAN.md §6.3.
 *
 * Razorpay signs `order_id|payment_id` with the key secret. We recompute it and
 * compare in constant time. A payment is only ever treated as real if this
 * passes; the client's word that it succeeded is worth nothing.
 */
export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(input.signature ?? "", "utf8");

  // timingSafeEqual throws on length mismatch, which is itself a signal.
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function markPaymentSuccessful(input: {
  user: User;
  orderId: string;
  paymentId: string;
  conversationId?: string | null;
}): Promise<{ amountPaise: number }> {
  const [payment] = await db
    .update(payments)
    .set({ status: "success", razorpayPaymentId: input.paymentId })
    .where(eq(payments.razorpayOrderId, input.orderId))
    .returning();

  await db.update(users).set({ plan: "pro" }).where(eq(users.id, input.user.id));

  await logAgentEvent({
    userId: input.user.id,
    conversationId: input.conversationId ?? null,
    type: "checkout_result",
    explanation: `Payment verified and the account is now on Pro. Charged ${formatPaise(payment?.amountPaise ?? 0)} in Razorpay test mode.`,
    facts: { amountPaise: payment?.amountPaise ?? 0 },
    meta: {
      outcome: "success",
      orderId: input.orderId,
      paymentId: input.paymentId,
      verification: "hmac_sha256_signature_match",
    },
  });

  return { amountPaise: payment?.amountPaise ?? 0 };
}

export async function markPaymentFailed(input: {
  user: User;
  orderId: string;
  reason: string;
  paymentId?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  await db
    .update(payments)
    .set({
      status: "failed",
      failureReason: input.reason.slice(0, 500),
      razorpayPaymentId: input.paymentId ?? null,
    })
    .where(eq(payments.razorpayOrderId, input.orderId));

  await logAgentEvent({
    userId: input.user.id,
    conversationId: input.conversationId ?? null,
    type: "checkout_result",
    explanation: `The payment did not go through: ${input.reason} The account is unchanged and still on Free. Nothing was charged.`,
    meta: {
      outcome: "failed",
      orderId: input.orderId,
      reason: input.reason,
    },
  });
}
