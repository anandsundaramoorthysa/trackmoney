import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { publicKeyJwk, signingAvailable } from "@/lib/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The public half of the merchant's signing key.
 *
 * A signature is only worth something if the other side can check it without
 * asking us whether it is valid — so the key has to be fetchable, and this is
 * the URL every signed artifact points at.
 *
 * When no key is configured the honest answer is that nothing is signed, said
 * plainly. A buyer that assumes signatures exist and finds none is worse off
 * than one told up front.
 */
async function handleGET() {
  if (!signingAvailable()) {
    return NextResponse.json(
      {
        signing: "disabled",
        detail:
          "No merchant signing key is configured, so cart mandates are returned unsigned. Set MERCHANT_SIGNING_KEY to enable it.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    signing: "enabled",
    algorithm: "ECDSA-P256-SHA256",
    canonicalisation:
      "JSON with object keys sorted and no insignificant whitespace, over the `payload` object exactly as returned.",
    key: publicKeyJwk(),
    note: "This is a published key, not a DID. AP2 resolves issuer keys through DID methods; this does not, and says so rather than implying otherwise.",
  });
}

export async function GET() {
  try {
    return await handleGET();
  } catch (error) {
    return handleRouteError(error);
  }
}
