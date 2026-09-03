import { NextResponse } from "next/server";

import {
  httpStatusFor,
  purchaseAsAgent,
  purchaseTerms,
} from "@/lib/agent-commerce";
import { handleRouteError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buying as a machine, over HTTP.
 *
 * The only entry point that is not a person. Everything a human click stands
 * for is replaced by a mandate the account holder issued in advance.
 *
 * Every rule lives in lib/agent-commerce.ts, shared with the MCP server. This
 * file decides one thing only: which status code a refusal deserves. Two
 * transports enforcing their own copies of the same gates would be two chances
 * to get them subtly different, and the second copy is always where a rule
 * quietly stops matching.
 *
 * What it deliberately cannot do: capture payment. A person still authorises
 * the order in Razorpay's own checkout. An AI buyer can commit its principal to
 * an order; it cannot move their money.
 */
async function handlePOST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  let body: { productId?: string; maxAmountMinor?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const productId = String(body.productId ?? "pro");

  if (!token) {
    /**
     * 402, not 401, and a payload that says what would satisfy it.
     *
     * 401 tells a buyer it is unauthenticated, which is not the situation: it
     * is unpaid. x402 revived HTTP's long-unused 402 for exactly this, and the
     * useful half is the body — an agent that meets a wall should learn the
     * amount, the currency, where authorisation comes from and how long an
     * answer stays good, rather than having to have read our documentation.
     *
     * The nonce is real. An earlier version generated one and never stored it,
     * which advertised replay resistance and provided none.
     */
    const terms = await purchaseTerms(productId);

    // No such product: a missing resource, not an unpaid one. Answering 402
    // here would send a buyer off to get authorised for a price we never quoted.
    if (!terms) {
      return NextResponse.json(
        {
          error: `No purchasable product with id "${productId}".`,
          refusedBecause: "product_unknown",
          documentation: "/api/catalog",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        error: "Payment authorisation required.",
        accepts: [terms],
        documentation: "/api/catalog",
      },
      {
        status: 402,
        headers: {
          "WWW-Authenticate": 'Bearer realm="trackmoney", scheme="trackmoney-mandate"',
        },
      },
    );
  }

  const result = await purchaseAsAgent({
    token,
    productId,
    maxAmountMinor: body.maxAmountMinor,
    nonce: request.headers.get("x-payment-challenge") ?? "",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        refusedBecause: result.refusedBecause,
        ...(result.priceMinor === undefined ? {} : { priceMinor: result.priceMinor }),
      },
      { status: httpStatusFor(result.refusedBecause) },
    );
  }

  return NextResponse.json({
    orderId: result.orderId,
    amountMinor: result.amountMinor,
    currency: result.currency,
    keyId: result.keyId,
    reused: result.reused,
    // The merchant's own signed assertion of what these terms were, so a buyer
    // can keep it and show it later without taking our word for it.
    cart: result.cart,
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
