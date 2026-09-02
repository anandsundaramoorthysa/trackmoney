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
      /**
       * What this merchant speaks, and what it does not.
       *
       * The agentic-payment protocols are young and none of them is settled,
       * so claiming compliance would be the easy lie. What is true is that the
       * ideas are borrowed deliberately and named, and that a buyer can see
       * exactly where the borrowing stops.
       */
      protocols: {
        x402: {
          supported: "partial",
          detail:
            "An unauthorised purchase is answered 402 Payment Required with an `accepts` payload naming the amount, the currency, where to obtain authorisation and a nonce. Settlement is Razorpay test mode, not an onchain transfer, so the payment half of x402 does not apply.",
        },
        ap2: {
          supported: "vocabulary-only",
          detail:
            "The three-mandate split is followed in substance: an intent the account holder authorised, a cart this merchant binds a price to, and a modality recorded on every order — human present, human present with agent assistance, or human not present. Nothing here is a W3C Verifiable Credential and nothing is signed by a wallet, so this is the shape of AP2 rather than AP2 itself.",
        },
        acp: {
          supported: "partial",
          detail:
            "This document is the machine-readable product feed. Delegated payment tokens are not implemented: no token issued here can move money, by design.",
        },
        uap: {
          supported: "no",
          detail:
            "NPCI's Unified Agent Protocol is not published in enough detail to implement against. Claiming support for a specification nobody can read would be worth nothing to a buyer.",
          note:
            "The mandate below is shaped like UPI Reserve Pay, which is the primitive agentic payments in India are actually being built on: a one-time, consent-based authorisation that names a merchant and caps what may be spent. That resemblance is deliberate — it is the model an Indian buyer will already understand — but it is a resemblance and not an integration. Nothing here touches UPI.",
        },
      },

      purchase: {
        endpoint: "/api/agent-commerce/orders",
        unauthorised:
          "402 Payment Required, with an `accepts` array describing what would satisfy it.",
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
