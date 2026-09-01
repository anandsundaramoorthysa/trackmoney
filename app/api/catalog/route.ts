import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { planConfig } from "@/lib/db/schema";
import { MANDATE_TTL_MINUTES } from "@/lib/mandates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An agent-readable catalogue
 *
 * Track 1 asks for an agent that grows a merchant's revenue *or* one that makes
 * a merchant transactable by an AI buyer end to end. This is the second half:
 * a machine can discover what is for sale, what it costs in minor units, and
 * exactly what it must present to buy it.
 *
 * Public on purpose. Prices are not a secret, and a catalogue nobody can read
 * without credentials is not a catalogue.
 */
async function handleGET() {
  const plans = await db.select().from(planConfig);
  const paid = plans.filter((plan) => plan.pricePaise > 0);

  return NextResponse.json(
    {
      protocol: "trackmoney.agent-commerce/1",
      merchant: {
        name: "TrackMoney",
        processor: "razorpay",
        mode: "test",
        note: "No real money moves. This merchant runs in Razorpay test mode.",
      },
      currency: "INR",
      minorUnit: "paise",
      products: paid.map((plan) => ({
        id: plan.plan,
        name: `TrackMoney ${plan.label}`,
        kind: "one_time",
        priceMinor: plan.pricePaise,
        currency: "INR",
        features: plan.features,
      })),
      purchase: {
        endpoint: "/api/agent-commerce/orders",
        method: "POST",
        authorization:
          "Bearer <purchase mandate>. A mandate is issued by the account holder, names one product, caps the amount, expires, and is spent by a single order.",
        requestBody: { productId: "string", maxAmountMinor: "integer" },
        settlement:
          "The response carries a Razorpay order id. A person authorises it in Razorpay's own checkout; this endpoint never captures payment and cannot.",
        gates: [
          "A valid, unspent, unexpired mandate naming this product",
          "The catalogue price must not exceed the mandate's cap",
          "One open order per account, enforced by a database constraint",
          "An account already on the paid plan cannot be charged again",
        ],
      },
      mandates: {
        obtainFrom: "/billing",
        singleUse: true,
        ttlMinutes: MANDATE_TTL_MINUTES,
      },
      auditTrail: {
        humanReadable: "/agent-activity",
        note: "Every order, refusal and outcome is recorded, whoever initiated it.",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function GET() {
  try {
    return await handleGET();
  } catch (error) {
    return handleRouteError(error);
  }
}
