import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api-errors";
import { and, desc, eq } from "drizzle-orm";

import { conversationForOrder, listConversationEvents } from "@/lib/audit";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { RAZORPAY_CURRENCY, razorpayCredentials } from "@/lib/razorpay";
import { getOrCreateConversation } from "@/lib/agent/conversation";
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

  let body: { kind?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Note what this route does NOT accept: a user id. The account is resolved
  // server-side (PLAN.md §6.2), so no caller can aim the agent at someone else.
  if (body.kind === "start") {
    const conversation = await getOrCreateConversation(user.id);
    const existing = await listConversationEvents(conversation.id);

    // The conversation already has history — another tab opened it, or a write
    // landed between this client's history fetch and this call. Hand back what
    // is on the record rather than a bare "skipped", which left the panel
    // permanently blank for whichever client lost the race.
    if (existing.length > 0) {
      return NextResponse.json({
        skipped: true,
        reason: "already_started",
        conversationId: conversation.id,
        messages: toChatMessages(existing),
      });
    }

    const result = await runAgentTurn({ user, message: null });
    return NextResponse.json(result);
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
