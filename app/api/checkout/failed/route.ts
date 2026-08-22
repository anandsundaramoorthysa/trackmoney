import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
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
async function handlePOST(request: Request) {
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




  await markPaymentFailed({
    user,
    orderId: body.orderId,
    paymentId: body.paymentId ?? null,
    reason: (body.reason ?? "Razorpay reported the payment as failed.").slice(0, 300),
  });

  return NextResponse.json({ recorded: true });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
