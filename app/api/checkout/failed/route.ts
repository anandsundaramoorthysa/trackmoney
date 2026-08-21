import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { getDemoUser } from "@/lib/demo";
import { markPaymentFailed } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The graceful-failure path — PLAN.md §6.10 (b).
 *
 * Razorpay's checkout fires `payment.failed` in the browser when a test-mode
 * failure card is used. We record it as a failed payment with its reason and
 * leave the account on Free. Nothing retries on its own, and the failure is as
 * visible in the audit trail as a success would be.
 */
export async function POST(request: Request) {
  const user = await getDemoUser();

  let body: { orderId?: string; paymentId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  await markPaymentFailed({
    user,
    orderId: body.orderId,
    paymentId: body.paymentId ?? null,
    reason: (body.reason ?? "Razorpay reported the payment as failed.").slice(0, 300),
    conversationId: conversation?.id ?? null,
  });

  return NextResponse.json({ recorded: true });
}
