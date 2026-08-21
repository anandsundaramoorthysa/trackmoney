import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

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
export async function POST(request: Request) {
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

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  const valid = verifyPaymentSignature({ orderId, paymentId, signature });

  if (!valid) {
    await markPaymentFailed({
      user,
      orderId,
      paymentId,
      reason: "the payment signature did not verify against our key secret, so it was rejected.",
      conversationId: conversation?.id ?? null,
    });

    return NextResponse.json(
      { verified: false, error: "Signature verification failed." },
      { status: 400 },
    );
  }

  const { amountPaise } = await markPaymentSuccessful({
    user,
    orderId,
    paymentId,
    conversationId: conversation?.id ?? null,
  });

  if (conversation) {
    await db
      .update(conversations)
      .set({ state: "converted" })
      .where(eq(conversations.id, conversation.id));
  }

  return NextResponse.json({ verified: true, plan: "pro", amountPaise });
}
