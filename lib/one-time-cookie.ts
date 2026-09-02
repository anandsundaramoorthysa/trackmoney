import crypto from "node:crypto";

import { cookies, headers } from "next/headers";

/**
 * Handing a secret to the next page without putting it in the URL.
 *
 * Reset codes and purchase mandates are bearer credentials: whoever holds one
 * can use it. Returning them via `redirect("/page?code=...")` writes them into
 * browser history and into every access log that records a query string, which
 * is a long-lived copy of a short-lived secret.
 *
 * A short httpOnly cookie carries the same value to the same next render
 * without either of those. It is scoped to this origin, unreadable by page
 * scripts, and gone in two minutes.
 *
 * Next.js only allows cookies to be written from a server action or route
 * handler, never during a render, so the page that displays a value cannot
 * clear it afterwards. A nonce closes the gap that leaves: the action returns
 * one, the page must present the matching nonce to read the value, and a cookie
 * left over from an earlier request therefore reveals nothing.
 *
 * That gap was real. Asking to reset an address that had never signed up
 * displayed the *previous* request's live reset code, because the page read the
 * cookie whenever the URL said a code had been sent.
 */

const TTL_SECONDS = 120;

/**
 * Secure unless the host is demonstrably local.
 *
 * Deciding this from `x-forwarded-proto` trusts a header to set a security
 * flag, and a forged `http` would strip Secure from a cookie travelling over
 * real TLS. Asking about the host instead means a spoof can only fail in the
 * safe direction.
 */
async function secureCookies(): Promise<boolean> {
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}

export async function stashOnce(name: string, value: string): Promise<string> {
  const nonce = crypto.randomBytes(9).toString("base64url");
  const jar = await cookies();
  jar.set(name, JSON.stringify({ n: nonce, v: value }), {
    httpOnly: true,
    sameSite: "lax",
    secure: await secureCookies(),
    path: "/",
    maxAge: TTL_SECONDS,
  });

  return nonce;
}

/** Returns the stashed value only to a caller holding the matching nonce. */
export async function readOnce(
  name: string,
  nonce: string | undefined,
): Promise<string | null> {
  if (!nonce) return null;

  const raw = (await cookies()).get(name)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { n?: string; v?: string };
    return parsed.n === nonce ? (parsed.v ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The same cookie, without the nonce handshake.
 *
 * The nonce existed to stop a page displaying a value the *previous* request
 * had stashed — asking to reset an unknown address once showed the live code
 * issued a minute earlier for a different one. It worked, and it cost something
 * worse: the nonce had to travel in the URL, so a registered address redirected
 * to `?sent=<handle>` while an unregistered one redirected to `?sent=1`. The
 * fix for a leak had become a louder leak, because now the address bar itself
 * said whether an account existed.
 *
 * Overwriting the cookie on *every* submission closes the staleness gap without
 * a handle: whatever is in there always belongs to the most recent request, so
 * there is nothing stale to show. The URL goes back to being the same for
 * everyone.
 */
export async function stashValue(name: string, value: string): Promise<void> {
  const jar = await cookies();
  jar.set(name, JSON.stringify({ v: value }), {
    httpOnly: true,
    sameSite: "lax",
    secure: await secureCookies(),
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function peekValue(name: string): Promise<string | null> {
  const raw = (await cookies()).get(name)?.value;
  if (!raw) return null;

  try {
    return (JSON.parse(raw) as { v?: string }).v ?? null;
  } catch {
    return null;
  }
}

export async function clearOnce(name: string): Promise<void> {
  const jar = await cookies();
  jar.delete(name);
}

export const MANDATE_COOKIE = "tm_mandate_once";
export const RESET_CODE_COOKIE = "tm_reset_once";
