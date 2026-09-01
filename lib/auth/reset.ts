import crypto from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { passwordResets } from "@/lib/db/schema";

/**
 * Password reset tokens
 *
 * Hashed, single-use, and dead 15 minutes after issue. The plain token is
 * returned to the caller exactly once and never stored, so a database leak
 * cannot be replayed into an account takeover.
 *
 * Delivery is deliberately pluggable. This demo has no mail provider, so the
 * code is surfaced in the UI with a note saying production would email it —
 * which is honest, and keeps the security-relevant half (issue, expiry,
 * single use, revocation of existing sessions) real rather than skipped.
 */

export const RESET_TTL_MINUTES = 15;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueResetToken(userId: string): Promise<string> {
  // Any earlier request is void: two live tokens would mean two ways in.
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(
      and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)),
    );

  const token = crypto.randomBytes(24).toString("base64url");
  await db.insert(passwordResets).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
  });

  return token;
}

/** How many resets this account asked for in the last hour. */
export async function recentResetCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.userId, userId),
        gt(passwordResets.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    )
    .orderBy(desc(passwordResets.createdAt))
    .limit(10);

  return rows.length;
}

export type ResetLookup =
  | { valid: true; userId: string; resetId: string }
  | { valid: false; reason: "unknown" | "expired" | "used" };

export async function lookupResetToken(token: string): Promise<ResetLookup> {
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return { valid: false, reason: "unknown" };
  if (row.usedAt) return { valid: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, userId: row.userId, resetId: row.id };
}

export async function consumeResetToken(resetId: string): Promise<void> {
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(passwordResets.id, resetId));
}
