import { NextResponse } from "next/server";

import { getDemoUser } from "@/lib/demo";
import { createProUpgradeOrder } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manual upgrade path — PLAN.md §2 step 5.
 *
 * This is the route the plain "Upgrade to Pro" button on the billing page hits.
 * It calls `createProUpgradeOrder`, which is the same function the agent's tool
 * calls. There is no agent-only order path anywhere in this codebase, which is
 * the whole point: the agent's authority over money is exactly a human's, no
 * more.
 *
 * It also takes no userId — the account comes from server context.
 */
export async function POST() {
  const user = await getDemoUser();

  const result = await createProUpgradeOrder(user, {
    initiatedBy: "billing_page",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, rule: result.rule },
      { status: result.rule === "already_pro" ? 409 : 500 },
    );
  }

  return NextResponse.json({
    orderId: result.orderId,
    amountPaise: result.amountPaise,
    currency: result.currency,
    keyId: result.keyId,
    reused: result.reused,
    userName: user.name,
    userEmail: user.email,
  });
}
