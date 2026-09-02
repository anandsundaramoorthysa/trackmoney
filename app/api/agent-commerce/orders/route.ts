import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { logAgentEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { planConfig, users } from "@/lib/db/schema";
import { checkMandate, consumeMandate, releaseMandate } from "@/lib/mandates";
import { formatPaise } from "@/lib/money";
import { createProUpgradeOrder } from "@/lib/razorpay";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buying as a machine
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
/** The Pro row, so the 402 quotes what the catalogue quotes. */
async function proProduct() {
  const [pro] = await db
    .select({ pricePaise: planConfig.pricePaise })
    .from(planConfig)
    .where(eq(planConfig.plan, "pro"))
    .limit(1);

  return pro ?? null;
}

async function handlePOST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    /**
     * 402, not 401, and a payload that says what would satisfy it.
     *
     * 401 tells a buyer it is unauthenticated, which is not the situation: it
     * is unpaid. x402 revived HTTP's long-unused 402 for exactly this, and the
     * useful half is the body — an agent that meets a wall should be told the
     * amount, the currency, where to obtain authorisation and how long an
     * answer stays good for, rather than having to have read our documentation
     * first.
     *
     * The nonce is there for the same reason x402 carries one: so a captured
     * response cannot be replayed as though it were a fresh demand.
     */
    const pro = await proProduct();

    return NextResponse.json(
      {
        error: "Payment authorisation required.",
        accepts: [
          {
            scheme: "trackmoney-mandate",
            protocol: "x402-style",
            amountMinor: pro?.pricePaise ?? null,
            currency: "INR",
            minorUnit: "paise",
            resource: "/api/agent-commerce/orders",
            authorisationEndpoint: "/billing",
            description:
              "A purchase mandate, issued by the account holder, presented as a bearer token.",
            expiresInSeconds: 1800,
            nonce: crypto.randomUUID(),
          },
        ],
        documentation: "/api/catalog",
      },
      {
        status: 402,
        headers: {
          // Named so a buyer can branch on the scheme without parsing the body.
          "WWW-Authenticate": 'Bearer realm="trackmoney", scheme="trackmoney-mandate"',
        },
      },
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

  /**
   * The buyer's own ceiling, honoured as documented.
   *
   * The catalogue advertises `maxAmountMinor` in the request body and the
   * endpoint used to ignore it, so an agent instructed to spend no more than
   * a hundred rupees was handed a four-hundred-and-ninety-nine rupee order
   * anyway. A published field that does nothing is worse than no field.
   */
  const buyerCeiling = body.maxAmountMinor;
  if (buyerCeiling !== undefined) {
    if (!Number.isInteger(buyerCeiling) || buyerCeiling <= 0) {
      return NextResponse.json(
        { error: "maxAmountMinor must be a positive whole number of paise." },
        { status: 400 },
      );
    }
    if (product.pricePaise > buyerCeiling) {
      return NextResponse.json(
        {
          error: `This product costs ${product.pricePaise} paise, above the ${buyerCeiling} you allowed.`,
          refusedBecause: "above_buyer_limit",
          priceMinor: product.pricePaise,
        },
        { status: 409 },
      );
    }
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
    // The order never happened, so the authorisation was not used. Only give it
    // back for a transport failure — an account already on Pro is a settled
    // answer, not a retryable one.
    if (result.rule !== "already_pro") {
      await releaseMandate(check.mandate.id);
    }

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
