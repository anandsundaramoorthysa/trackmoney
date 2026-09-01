import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { conversationForOrder, logAgentEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { payments, planConfig, users, type User } from "@/lib/db/schema";
import { formatPaise } from "@/lib/money";

/**
 * The one shared money function.
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

/**
 * Read per call rather than captured at module load, so behaviour never depends
 * on import order. Overridable so the test suite can point the same code at a
 * local stand-in that signs with the same secret. Production never sets it.
 */
function razorpayApiBase(): string {
  return process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com";
}

export function razorpayCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay keys are missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.local.",
    );
  }

  if (!keyId.startsWith("rzp_test_")) {
    // test mode only, everywhere, always.
    throw new Error(
      "Refusing to start: RAZORPAY_KEY_ID is not a test-mode key. TrackMoney is a demo and must never be pointed at live keys.",
    );
  }

  return { keyId, keySecret };
}

type RazorpayOrder = { id: string; amount: number; currency: string };

/**
 * Orders API call, written as plain HTTP rather than through the SDK.
 *
 * The request a judge is being asked to trust is then readable in full, right
 * here, instead of behind a vendor wrapper — and it drops a dependency.
 */
async function postOrder(body: Record<string, unknown>): Promise<RazorpayOrder> {
  const { keyId, keySecret } = razorpayCredentials();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const response = await fetch(`${razorpayApiBase()}/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Razorpay responded ${response.status}: ${detail}`);
  }

  return (await response.json()) as RazorpayOrder;
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
    initiatedBy: "agent" | "billing_page" | "ai_buyer";
    conversationId?: string | null;
  },
): Promise<CreateOrderResult> {
  /**
   * Rule 5 — already on Pro. Applies to every caller.
   *
   * Read the plan from the database rather than trusting the `User` handed in.
   * Every caller loads that object at the start of its own request, so a second
   * tab, an agent panel holding a live offer, or an AI buyer working from a
   * mandate can all arrive with a copy that predates the upgrade. Trusting it
   * meant an account that had just paid could be given a second order, and a
   * second order is a second charge. Charging twice for one plan is the single
   * mistake a payments demo cannot make.
   */
  const [onRecord] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if ((onRecord?.plan ?? user.plan) === "pro") {
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

  const { keyId } = razorpayCredentials();

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
        // A deduplicated no-op, not a new money action.
        reused: true,
        moneyMoved: false,
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
    const order = await postOrder({
      amount: pro.pricePaise,
      currency: RAZORPAY_CURRENCY,
      receipt: `tm_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        plan: "pro",
        initiated_by: options.initiatedBy,
      },
    });

    try {
      await db.insert(payments).values({
        userId: user.id,
        razorpayOrderId: order.id,
        amountPaise: pro.pricePaise,
        status: "created",
        initiatedBy: options.initiatedBy,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      /**
       * Another request created an order between our check and our write.
       *
       * The database is the authority on "one open order", so the loser hands
       * back the winner's order rather than a second one. The order we had
       * just created at Razorpay is abandoned unpaid — recorded here rather
       * than left silent, because an order nobody can reach is exactly the
       * kind of thing an audit trail exists to show.
       */
      const [winner] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.userId, user.id), eq(payments.status, "created")))
        .limit(1);

      await logAgentEvent({
        userId: user.id,
        conversationId: options.conversationId ?? null,
        type: "checkout_created",
        explanation: `Two checkouts were requested at once. Kept ${winner?.razorpayOrderId ?? "the existing order"} and abandoned ${order.id}, which was never paid.`,
        meta: {
          rule: "one_open_order_per_user",
          reused: true,
          moneyMoved: false,
          abandonedOrderId: order.id,
          orderId: winner?.razorpayOrderId,
          initiatedBy: options.initiatedBy,
        },
      });

      if (!winner) {
        return {
          ok: false,
          rule: "razorpay_error",
          message: "Another checkout was already in progress.",
        };
      }

      return {
        ok: true,
        orderId: winner.razorpayOrderId,
        amountPaise: winner.amountPaise,
        currency: RAZORPAY_CURRENCY,
        keyId,
        reused: true,
      };
    }

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
      explanation: `Could not create the Razorpay order: ${message}. No payment was attempted.`,
      meta: {
        outcome: "order_creation_failed",
        // Not a payment outcome: no order existed, so nothing could be paid.
        // The activity page reads this to label and tally the row honestly.
        moneyMoved: false,
        initiatedBy: options.initiatedBy,
      },
    });

    return { ok: false, rule: "razorpay_error", message };
  }
}

/**
 * Payment verification
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

export type SettleResult =
  | { settled: true; amountPaise: number; alreadySettled: boolean }
  | { settled: false; reason: "unknown_order" };

export async function markPaymentSuccessful(input: {
  user: User;
  orderId: string;
  paymentId: string;
}): Promise<SettleResult> {
  // Resolved here rather than by each caller, so every path attributes the
  // outcome the same way: to whichever conversation handed this order over.
  const conversationId = await conversationForOrder(input.user.id, input.orderId);

  const [existing] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.razorpayOrderId, input.orderId),
        eq(payments.userId, input.user.id),
      ),
    )
    .limit(1);

  // A validly signed payment for an order this database has never heard of —
  // reachable by resetting the demo while a checkout is open. Previously the
  // amount defaulted to zero, so the trail recorded "Charged ₹0" and granted
  // Pro anyway. An unknown amount is not a zero amount, and it is not something
  // to settle silently.
  if (!existing) {
    await logAgentEvent({
      userId: input.user.id,
      conversationId,
      type: "checkout_result",
      explanation:
        "A correctly signed payment arrived for an order this account has no record of, so the plan was left unchanged. This happens if the demo data is reset while a checkout is open.",
      meta: {
        outcome: "unknown_order",
        orderId: input.orderId,
        paymentId: input.paymentId,
        moneyMoved: false,
      },
    });
    return { settled: false, reason: "unknown_order" };
  }

  // Replaying the same verification must not write a second success.
  if (existing.status === "success") {
    return {
      settled: true,
      amountPaise: existing.amountPaise,
      alreadySettled: true,
    };
  }

  /**
   * Has this account already paid for Pro on some other order?
   *
   * Order creation is where a second charge is prevented, and it now reads the
   * plan from the database so it cannot be fooled by a stale copy. This is the
   * backstop. If a second payment ever does arrive, refusing to record it would
   * be the worse answer — Razorpay has the money either way, and a payment the
   * app denies is a payment nobody can reconcile. So it is recorded, and the
   * trail says plainly that it should not have happened.
   */
  const priorSuccess = await db
    .select({ orderId: payments.razorpayOrderId, amountPaise: payments.amountPaise })
    .from(payments)
    .where(and(eq(payments.userId, input.user.id), eq(payments.status, "success")))
    .limit(1);

  const duplicate = priorSuccess.find((p) => p.orderId !== input.orderId);

  await db
    .update(payments)
    .set({ status: "success", razorpayPaymentId: input.paymentId })
    .where(eq(payments.id, existing.id));

  await db.update(users).set({ plan: "pro" }).where(eq(users.id, input.user.id));

  await logAgentEvent({
    userId: input.user.id,
    conversationId,
    type: "checkout_result",
    explanation: duplicate
      ? `Payment verified, but this account had already paid ${formatPaise(duplicate.amountPaise)} for Pro on an earlier order. The money moved, so it is recorded here rather than hidden — it needs refunding.`
      : `Payment verified and the account is now on Pro. Charged ${formatPaise(existing.amountPaise)} in Razorpay test mode.`,
    facts: { amountPaise: existing.amountPaise },
    meta: {
      outcome: duplicate ? "duplicate_purchase" : "success",
      orderId: input.orderId,
      paymentId: input.paymentId,
      verification: "hmac_sha256_signature_match",
      initiatedBy: existing.initiatedBy,
      ...(duplicate ? { alreadyPaidOn: duplicate.orderId } : {}),
    },
  });

  return {
    settled: true,
    amountPaise: existing.amountPaise,
    alreadySettled: false,
  };
}

export async function markPaymentFailed(input: {
  user: User;
  orderId: string;
  reason: string;
  paymentId?: string | null;
}): Promise<void> {
  const conversationId = await conversationForOrder(input.user.id, input.orderId);

  // Scoped to the account, exactly as the success path is. An order id is not
  // a capability: knowing one must not let a different account write to it.
  const [existing] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.razorpayOrderId, input.orderId),
        eq(payments.userId, input.user.id),
      ),
    )
    .limit(1);

  /**
   * A payment that already succeeded cannot later become a failure.
   *
   * Razorpay's `payment.failed` fires per attempt, not per order, so a user who
   * fails once and retries in the same modal produces both events — and the
   * failure POST is not awaited, so it can land last. Without this guard the
   * order that bought Pro ends up marked failed, with the account still on Pro
   * and the trail asserting nothing was charged.
   */
  if (existing?.status === "success") {
    await logAgentEvent({
      userId: input.user.id,
      conversationId,
      type: "checkout_result",
      explanation: `A failure was reported for ${input.orderId}, but that payment had already been verified and settled, so it was ignored.`,
      meta: {
        outcome: "late_failure_ignored",
        orderId: input.orderId,
        moneyMoved: false,
        initiatedBy: existing.initiatedBy,
      },
    });
    return;
  }

  const updated = await db
    .update(payments)
    .set({
      status: "failed",
      failureReason: input.reason.slice(0, 500),
      // Only overwrite the payment id if we were actually given one.
      ...(input.paymentId ? { razorpayPaymentId: input.paymentId } : {}),
    })
    .where(
      and(
        eq(payments.razorpayOrderId, input.orderId),
        eq(payments.userId, input.user.id),
      ),
    )
    .returning();

  if (updated.length === 0) {
    await logAgentEvent({
      userId: input.user.id,
      conversationId,
      type: "checkout_result",
      explanation:
        "A payment failure was reported for an order this account has no record of, so nothing was changed.",
      meta: { outcome: "unknown_order", orderId: input.orderId, moneyMoved: false },
    });
    return;
  }

  await logAgentEvent({
    userId: input.user.id,
    conversationId,
    type: "checkout_result",
    explanation: `The payment did not go through: ${input.reason} The account is unchanged and still on Free. Nothing was charged.`,
    meta: {
      outcome: "failed",
      orderId: input.orderId,
      reason: input.reason,
      // Present on success rows too, so the activity page can say whose
      // payment this was on the failure path as well.
      initiatedBy: updated[0].initiatedBy,
    },
  });
}
