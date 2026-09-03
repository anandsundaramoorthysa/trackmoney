import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { and, desc, eq } from "drizzle-orm";

import { conversationForOrder, listConversationEvents } from "@/lib/audit";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { RAZORPAY_CURRENCY, razorpayCredentials } from "@/lib/razorpay";
import { getOrCreateConversation } from "@/lib/agent/conversation";
import { claimForExplanation, renderOne } from "@/lib/notifications/store";
import { logAgentEvent } from "@/lib/audit";
import { runAgentTurn } from "@/lib/agent/run";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_TYPES = new Set([
  "suggestion",
  "agent_reply",
  "user_reply",
  "checkout_result",
]);

type ChatEvent = {
  id: string;
  type: string;
  explanation: string;
  createdAt: Date;
};

function toChatMessages(events: ChatEvent[]) {
  return events
    .filter((e) => CHAT_TYPES.has(e.type))
    .map((e) => ({
      id: e.id,
      role: e.type === "user_reply" ? "user" : "agent",
      type: e.type,
      text: e.explanation,
      at: e.createdAt,
    }));
}

/** Returns the conversation as the audit trail already recorded it. */
async function handleGET() {
  const user = await getAuthenticatedUser();
  const conversation = await getOrCreateConversation(user.id);
  const events = await listConversationEvents(conversation.id);

  /**
   * An order the agent prepared but nobody has paid yet. Without this the
   * agent's "use the button below" message survived a reload while the button
   * itself did not, stranding an open order.
   *
   * Which orders count is decided the same way payment outcomes are — by which
   * conversation handed the order over — rather than by `initiatedBy`. An order
   * started on the Billing page and then handed over by the agent is the
   * agent's to restore, and reading the flag missed exactly that case.
   *
   * A declined conversation restores nothing: leaving a live checkout button
   * under "I will not bring this up again" would be the nagging the rule exists
   * to prevent.
   */
  const [open] =
    conversation.state === "declined"
      ? []
      : await db
          .select()
          .from(payments)
          .where(
            and(eq(payments.userId, user.id), eq(payments.status, "created")),
          )
          .orderBy(desc(payments.createdAt))
          .limit(1);

  const handedOverHere =
    open && (await conversationForOrder(user.id, open.razorpayOrderId)) === conversation.id;

  return NextResponse.json({
    conversationId: conversation.id,
    state: conversation.state,
    plan: user.plan,
    messages: toChatMessages(events),
    checkout: open && handedOverHere
      ? {
          orderId: open.razorpayOrderId,
          amountPaise: open.amountPaise,
          currency: RAZORPAY_CURRENCY,
          keyId: razorpayCredentials().keyId,
          reused: true,
        }
      : null,
  });
}

async function handlePOST(request: Request) {
  const user = await getAuthenticatedUser();

  let body: { kind?: string; message?: string; notificationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  /**
   * Note what this route does NOT accept: a user id. The account is resolved
   * server-side, so no caller can aim the agent at someone else. That property
   * matters more now than it did — `notificationId` is a caller-supplied
   * identifier, and it is scoped to the session's own account before it is used
   * for anything.
   *
   * The "start" kind is gone. There is no longer any such thing as a turn the
   * agent begins: it used to open every conversation with a pitch nobody asked
   * for, which is the whole reason the bell exists.
   */
  if (body.kind === "explain") {
    const notificationId =
      typeof body.notificationId === "string" ? body.notificationId : "";
    if (!notificationId) {
      return NextResponse.json(
        { error: "notificationId is required." },
        { status: 400 },
      );
    }

    const { row, alreadyExplained } = await claimForExplanation(
      user,
      notificationId,
    );

    // Not this account's row, or no such row. The same answer either way, so
    // the endpoint cannot be used to find out which ids exist.
    if (!row) {
      return NextResponse.json(
        { error: "No such notification." },
        { status: 404 },
      );
    }

    const conversation = await getOrCreateConversation(user.id);

    // A refresh, a second tab, or React re-mounting in development. The
    // explanation already happened and must not happen twice — the upgrade one
    // records a pitch, and recording it twice would put two suggestions in the
    // trail for one thing the person opened once.
    if (alreadyExplained) {
      return NextResponse.json({
        skipped: true,
        reason: "already_explained",
        conversationId: conversation.id,
        messages: toChatMessages(await listConversationEvents(conversation.id)),
      });
    }

    const { rendered } = await renderOne(user, row);
    if (!rendered) {
      return NextResponse.json(
        { error: "That notification is no longer available." },
        { status: 410 },
      );
    }

    await logAgentEvent({
      userId: user.id,
      conversationId: conversation.id,
      type: "notification_opened",
      explanation: `The user opened the notification "${rendered.title}".`,
      meta: { kind: row.kind, notificationId: row.id },
    });

    const result = await runAgentTurn({
      user,
      message: null,
      explain: { kind: row.kind, body: rendered.body },
    });

    return NextResponse.json({ ...result, explaining: { id: row.id, title: rendered.title } });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }
  if (message.length > 500) {
    return NextResponse.json(
      { error: "message is too long." },
      { status: 400 },
    );
  }

  const result = await runAgentTurn({ user, message });
  return NextResponse.json(result);
}

export async function GET() {
  try {
    return await handleGET();
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}
