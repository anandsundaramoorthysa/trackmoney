import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { conversationForOrder } from "@/lib/audit";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { getDemoUser } from "@/lib/demo";
import {
  markPaymentFailed,
  markPaymentSuccessful,
  verifyPaymentSignature,
} from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payment verification — PLAN.md §6.3.
 *
 * The browser telling us a payment succeeded proves nothing. The plan only
 * flips to Pro if the HMAC signature Razorpay returned verifies against our own
 * key secret, recomputed here. A failed verification is recorded as a failed
 * payment, not swallowed.
 */
async function handlePOST(request: Request) {
  const user = await getDemoUser();

  let body: {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;

  if (!orderId || !paymentId || !signature) {
    return NextResponse.json(
      { error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required." },
      { status: 400 },
    );
  }



  /**
   * A payment started from the billing page has nothing to do with the agent,
   * so attaching its outcome to the agent's conversation made the trail — and
   * the chat panel, which replays conversation events — report the agent as
   * having done something a person did alone.
   *
   * The reverse case matters too: an order the agent handed over was paid
   * through the agent's button even if a person created it first, and the chat
   * has to learn the outcome. The audit trail records which conversation
   * offered which order, so that is what decides it.
   */
  const attributedConversationId = await conversationForOrder(user.id, orderId);

  const valid = verifyPaymentSignature({ orderId, paymentId, signature });

  if (!valid) {
    await markPaymentFailed({
      user,
      orderId,
      paymentId,
      reason: "the payment signature did not verify against our key secret, so it was rejected.",
    });

    return NextResponse.json(
      { verified: false, error: "Signature verification failed." },
      { status: 400 },
    );
  }

  const settlement = await markPaymentSuccessful({
    user,
    orderId,
    paymentId,
  });

  if (!settlement.settled) {
    return NextResponse.json(
      {
        verified: true,
        settled: false,
        error:
          "That payment is valid but does not match any order on this account, so nothing was changed.",
      },
      { status: 409 },
    );
  }

  if (attributedConversationId) {
    await db
      .update(conversations)
      .set({ state: "converted" })
      .where(eq(conversations.id, attributedConversationId));
  }

  return NextResponse.json({
    verified: true,
    settled: true,
    plan: "pro",
    amountPaise: settlement.amountPaise,
  });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
