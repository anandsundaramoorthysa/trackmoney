import crypto from "node:crypto";

/**
 * Signing what this merchant asserts.
 *
 * AP2 binds an agent purchase together with signed mandates: an intent the
 * person authorised, a cart the merchant bound a price to, and a credential the
 * network sees. The signatures are the point — a bearer token says only "the
 * holder had this", while a signature says "this merchant asserted exactly
 * these terms, and here is how to check without asking us".
 *
 * ECDSA over P-256 with SHA-256, which is what AP2 names. What this is not:
 * AP2 mandates are JSON-LD Verifiable Credentials with issuer keys resolved
 * through DIDs, and there is no DID here. The key is published at a URL. That
 * is a real, checkable signature and an honest step short of the specification,
 * and calling it the specification would be the kind of claim this project
 * spends its time avoiding.
 *
 * The key is generated once and kept in the environment. Without one, signing
 * is skipped rather than faked — an unsigned artifact that says it is signed
 * would be worse than no artifact.
 */

const CURVE = "prime256v1";

/** Set MERCHANT_SIGNING_KEY to a PEM PKCS#8 private key to turn signing on. */
function privateKey(): crypto.KeyObject | null {
  const pem = process.env.MERCHANT_SIGNING_KEY;
  if (!pem || !pem.includes("PRIVATE KEY")) return null;

  try {
    return crypto.createPrivateKey(pem.replace(/\\n/g, "\n"));
  } catch {
    // A malformed key is a configuration mistake, not a reason to serve
    // something that looks signed and is not.
    return null;
  }
}

export function signingAvailable(): boolean {
  return privateKey() !== null;
}

/** The public half, for anyone verifying. */
export function publicKeyJwk(): crypto.JsonWebKey | null {
  const key = privateKey();
  if (!key) return null;

  return crypto.createPublicKey(key).export({ format: "jwk" });
}

export type SignedAssertion<T> = {
  payload: T;
  signature: {
    algorithm: "ECDSA-P256-SHA256";
    /** Base64url over the canonical JSON of `payload`. */
    value: string;
    publicKey: "/api/agent-commerce/key";
  };
};

/**
 * Canonical JSON: keys sorted, no incidental whitespace.
 *
 * A signature is over bytes, so both sides have to agree on which bytes. Two
 * encoders that order keys differently produce two different documents from
 * the same object, and the verification fails for a reason nobody can see.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);

  return `{${entries.join(",")}}`;
}

/** Sign a payload, or hand it back unsigned when no key is configured. */
export function sign<T>(payload: T): SignedAssertion<T> | { payload: T } {
  const key = privateKey();
  if (!key) return { payload };

  const signature = crypto
    .sign("sha256", Buffer.from(canonical(payload), "utf8"), key)
    .toString("base64url");

  return {
    payload,
    signature: {
      algorithm: "ECDSA-P256-SHA256",
      value: signature,
      publicKey: "/api/agent-commerce/key",
    },
  };
}

/** Verification, exported so the tests check the real thing rather than a mock. */
export function verify(payload: unknown, signature: string): boolean {
  const key = privateKey();
  if (!key) return false;

  try {
    return crypto.verify(
      "sha256",
      Buffer.from(canonical(payload), "utf8"),
      crypto.createPublicKey(key),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** Used by the setup script; never called at request time. */
export function generateKeyPairPem(): { privateKey: string; publicKey: string } {
  const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync("ec", {
    namedCurve: CURVE,
  });

  return {
    privateKey: priv.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pub.export({ type: "spki", format: "pem" }).toString(),
  };
}
