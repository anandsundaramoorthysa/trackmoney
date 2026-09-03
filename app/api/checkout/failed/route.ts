import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { markPaymentFailed } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The graceful-failure path (b).
 *
 * Razorpay's checkout fires `payment.failed` in the browser when a test-mode
 * failure card is used. We record it as a failed payment with its reason and
 * leave the account on Free. Nothing retries on its own, and the failure is as
 * visible in the audit trail as a success would be.
 */
async function handlePOST(request: Request) {
  const user = await getAuthenticatedUser();

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

  // Both pages render this order. Without these, billing still says "No orders
  // yet" after a decline and only tells the truth once the user reloads by
  // hand — which reads as the failure not having been recorded at all.
  revalidatePath("/billing");
  revalidatePath("/agent-activity");

  return NextResponse.json({ recorded: true });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
