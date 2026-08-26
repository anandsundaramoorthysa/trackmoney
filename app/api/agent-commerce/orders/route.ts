import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { logAgentEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { planConfig, users } from "@/lib/db/schema";
import { checkMandate, consumeMandate } from "@/lib/mandates";
import { formatPaise } from "@/lib/money";
import { createProUpgradeOrder } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buying as a machine — PLAN.md §10.5.
 *
 * The only entry point that is not a person. Everything a human click stands
 * for is replaced by a mandate the account holder issued in advance, and the
 * order itself still goes through `createProUpgradeOrder` — the same function
 * the billing button and the assistant use.
 *
 * What it deliberately cannot do: capture payment. A person still authorises
 * the order in Razorpay's checkout. An AI buyer can commit its principal to an
 * order; it cannot move their money.
 */
async function handlePOST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    return NextResponse.json(
      {
        error:
          "A purchase mandate is required. See /api/catalog for how to obtain one.",
      },
      { status: 401 },
    );
  }

  let body: { productId?: string; maxAmountMinor?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const productId = String(body.productId ?? "");
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  const [product] = await db
    .select()
    .from(planConfig)
    .where(eq(planConfig.plan, productId as "free" | "pro"))
    .limit(1);

  if (!product || product.pricePaise <= 0) {
    return NextResponse.json(
      { error: `No purchasable product with id "${productId}".` },
      { status: 404 },
    );
  }

  const check = await checkMandate({
    token,
    productId,
    pricePaise: product.pricePaise,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: check.message, refusedBecause: check.reason },
      { status: check.reason === "unknown" ? 401 : 403 },
    );
  }

  const [buyer] = await db
    .select()
    .from(users)
    .where(eq(users.id, check.mandate.userId))
    .limit(1);

  if (!buyer) {
    return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  }

  /**
   * Spend the mandate before creating the order, not after.
   *
   * Two buyers racing the same token would otherwise both pass the check. The
   * update only succeeds for whoever gets there first, so the loser is refused
   * rather than handed a second purchase.
   */
  if (!(await consumeMandate(check.mandate.id))) {
    return NextResponse.json(
      { error: "That mandate was spent by another request.", refusedBecause: "used" },
      { status: 403 },
    );
  }

  await logAgentEvent({
    userId: buyer.id,
    type: "intent",
    explanation: `An AI buyer presented a mandate for ${formatPaise(product.pricePaise)} of "${productId}". The mandate was issued by the account holder and is now spent.`,
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
    return NextResponse.json(
      { error: result.message, refusedBecause: result.rule },
      { status: result.rule === "already_pro" ? 409 : 502 },
    );
  }

  return NextResponse.json({
    orderId: result.orderId,
    amountMinor: result.amountPaise,
    currency: result.currency,
    reused: result.reused,
    settlement: {
      status: "awaiting_human_authorisation",
      note: "This order is prepared, not paid. The account holder authorises it in Razorpay's checkout.",
      checkoutKeyId: result.keyId,
    },
    auditTrail: "/agent-activity",
  });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
