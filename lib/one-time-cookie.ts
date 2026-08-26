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
 * Note the deliberate limitation: Next.js only allows cookies to be written
 * from a server action or route handler, never during a render, so the page
 * that displays the value cannot clear it. The short lifetime is what bounds
 * the exposure instead.
 */

const TTL_SECONDS = 120;

export async function stashOnce(name: string, value: string): Promise<void> {
  const jar = await cookies();
  jar.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      ((await headers()).get("x-forwarded-proto") ?? "http")
        .split(",")[0]
        .trim() === "https",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function readOnce(name: string): Promise<string | null> {
  const jar = await cookies();
  return jar.get(name)?.value ?? null;
}

export async function clearOnce(name: string): Promise<void> {
  const jar = await cookies();
  jar.delete(name);
}

export const MANDATE_COOKIE = "tm_mandate_once";
export const RESET_CODE_COOKIE = "tm_reset_once";
