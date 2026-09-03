import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  notifications,
  type Notification,
  type NotificationKind,
  type User,
} from "@/lib/db/schema";
import { computeUsageFacts, type UsageFacts } from "@/lib/facts";
import { getOrCreateConversation } from "@/lib/agent/conversation";
import { checkClaims, checkGrounding } from "@/lib/agent/grounding";
import { logAgentEvent } from "@/lib/audit";
import {
  deriveNotifications,
  renderNotification,
  stillTrue,
  type RenderedNotification,
} from "./derive";

/**
 * Notifications, persisted.
 *
 * Generation happens on read rather than on write, and that is a deliberate
 * trade rather than laziness. A write hook is where the trigger honestly lives
 * — facts only move when rows move — but it misses the month rolling over,
 * which is not a write, and it would have to be taught that importing a
 * statement is one event and not three hundred. Reading handles both for free.
 *
 * Its two costs are real and both already have answers in this codebase. A read
 * that writes can race itself, so the unique index decides the winner instead
 * of a check-then-insert. And `computeUsageFacts` is not cheap, so it runs here
 * — on the bell's own endpoint — and never in a layout render.
 */

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  at: string;
};

/** The facts a row was built from, as they were at the time. */
function snapshotOf(row: Notification): UsageFacts | null {
  return (row.facts as UsageFacts | null) ?? null;
}

/**
 * Render a row, refusing to serve anything the gates reject.
 *
 * This is the part that makes "the same gates apply" true rather than claimed.
 * The body is checked against the very snapshot it was rendered from, so a
 * template that hardcodes a figure, or interpolates the wrong field, is
 * suppressed here rather than shown to somebody as a fact about their money.
 * A suppressed row is logged, because a notification that silently vanished
 * would be indistinguishable from one that was never generated.
 */
async function renderChecked(
  userId: string,
  row: Notification,
): Promise<RenderedNotification | null> {
  const snapshot = snapshotOf(row);
  if (!snapshot) return null;

  const rendered = renderNotification(row.kind, snapshot);
  const grounded = checkGrounding(rendered.body, snapshot);
  const claims = checkClaims(rendered.body, snapshot);

  if (grounded.ok && claims.ok) return rendered;

  await logAgentEvent({
    userId,
    conversationId: row.conversationId,
    type: "tool_refused",
    explanation: `A notification was withheld because its own wording did not pass the checks every reply passes (${row.kind}).`,
    meta: {
      rule: "notification_failed_gate",
      ungroundedNumbers: grounded.offending,
      brokenClaims: claims.wrong,
      enforcedIn: "lib/notifications/store.ts",
    },
  }).catch(() => {});

  return null;
}

/**
 * Bring this account's notifications up to date, then return them.
 *
 * Insert-only. Nothing is updated in place: a row that has been shown to
 * somebody keeps the numbers it was shown with, and one that has stopped being
 * true is filtered out by `stillTrue` rather than rewritten. Rewriting text a
 * person has already read is how a record becomes dishonest.
 */
export async function syncNotifications(user: User): Promise<Notification[]> {
  const facts = await computeUsageFacts(user);
  const conversation = await getOrCreateConversation(user.id);

  const wanted = deriveNotifications(facts, conversation.state);

  if (wanted.length > 0) {
    await db
      .insert(notifications)
      .values(
        wanted.map((w) => ({
          userId: user.id,
          conversationId: conversation.id,
          kind: w.kind,
          dedupKey: w.dedupKey,
          facts: facts as unknown as Record<string, unknown>,
        })),
      )
      // The index is the arbiter. Two tabs asking at the same moment produce
      // one row, and the loser does not need to know it lost.
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupKey],
      });
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt));

  // Decay, asked fresh rather than remembered. A cap notice from before an
  // upgrade simply stops being listed.
  return rows.filter((row) => stillTrue(row.kind, facts, conversation.state));
}

export async function listNotifications(user: User): Promise<{
  items: NotificationView[];
  unread: number;
}> {
  const rows = await syncNotifications(user);

  const items: NotificationView[] = [];
  for (const row of rows) {
    const rendered = await renderChecked(user.id, row);
    if (!rendered) continue;
    items.push({
      id: row.id,
      kind: row.kind,
      title: rendered.title,
      body: rendered.body,
      read: row.readAt !== null,
      at: row.createdAt.toISOString(),
    });
  }

  return { items, unread: items.filter((i) => !i.read).length };
}

/** Mark one row, or all of them, as seen. Never pitches, never explains. */
export async function markNotificationsRead(
  user: User,
  id?: string,
): Promise<void> {
  const where = id
    ? and(
        eq(notifications.userId, user.id),
        eq(notifications.id, id),
        isNull(notifications.readAt),
      )
    : and(eq(notifications.userId, user.id), isNull(notifications.readAt));

  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

/**
 * Withdraw a pending pitch when somebody says no.
 *
 * Without this, a person declines in the chat and the badge is still lit with
 * the offer they just refused — the bell would become exactly the nagging
 * channel the decline rule exists to prevent. Only the upgrade notice is
 * withdrawn; a cap warning is about their account, not about the sale, and
 * survives.
 */
export async function dismissUpgradeNotifications(
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "upgrade_available"),
        isNull(notifications.dismissedAt),
      ),
    );
}

/**
 * Claim a notification for explanation, exactly once.
 *
 * A conditional update rather than a read followed by a write, because two tabs
 * opening the same row would both pass a read-then-check and the upgrade one
 * writes a suggestion event. The row comes back only to the caller that won,
 * which is the same shape the payments table uses to stop two requests settling
 * one order.
 */
export async function claimForExplanation(
  user: User,
  id: string,
): Promise<{ row: Notification | null; alreadyExplained: boolean }> {
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.id, id)))
    .limit(1);

  if (!existing) return { row: null, alreadyExplained: false };

  const claimed = await db
    .update(notifications)
    .set({ explainedAt: new Date(), readAt: existing.readAt ?? new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, user.id),
        isNull(notifications.explainedAt),
      ),
    )
    .returning();

  return { row: existing, alreadyExplained: claimed.length === 0 };
}

/** The rendered text of one row, for the turn that explains it. */
export async function renderOne(
  user: User,
  row: Notification,
): Promise<{ rendered: RenderedNotification | null; snapshot: UsageFacts | null }> {
  const snapshot = snapshotOf(row);
  const rendered = await renderChecked(user.id, row);
  return { rendered, snapshot };
}

/** Used by the seed and the demo reset. */
export async function deleteNotificationsFor(userId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}

/** Kept for callers that only need the badge. */
export async function unreadCount(user: User): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
      ),
    );
  return row?.n ?? 0;
}
