import crypto from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";

/**
 * Sessions — PLAN.md §10.3.
 *
 * A random 256-bit token lives in the user's cookie. Only its SHA-256 hash is
 * stored, so a leaked database hands over no usable sessions — the same
 * reasoning as password hashing, applied to the credential that actually rides
 * on every request.
 *
 * SHA-256 rather than scrypt here on purpose: the token is already random, so
 * there is nothing to brute-force, and every request would otherwise pay a
 * deliberately slow hash.
 */

export const SESSION_COOKIE = "tm_session";
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Whether to mark the cookie Secure.
 *
 * Read from the request rather than from NODE_ENV. A production build served
 * over plain HTTP — which is exactly what the browser test suite does — would
 * otherwise set a Secure cookie that never comes back, and the failure looks
 * like a broken login rather than a transport mismatch. Behind Vercel this is
 * always https.
 */
async function isSecureRequest(): Promise<boolean> {
  const forwarded = (await headers()).get("x-forwarded-proto");
  return (forwarded ?? "http").split(",")[0].trim() === "https";
}

export async function createSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in user, or null. Never throws — callers decide what to do. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row?.user ?? null;
}

/**
 * The signed-in user, or an error.
 *
 * Used by API routes and server actions that have no business running without
 * one. Pages redirect instead — see requireUser in lib/auth/guard.ts.
 */
export async function getAuthenticatedUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Signing out everywhere — used after a password reset. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping, cheap enough to run opportunistically. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
