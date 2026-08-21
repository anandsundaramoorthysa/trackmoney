import { NextResponse } from "next/server";

import { listConversationEvents } from "@/lib/audit";
import { getOrCreateConversation } from "@/lib/agent/conversation";
import { runAgentTurn } from "@/lib/agent/run";
import { getDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_TYPES = new Set([
  "suggestion",
  "agent_reply",
  "user_reply",
  "checkout_result",
]);

/** Returns the conversation as the audit trail already recorded it. */
export async function GET() {
  const user = await getDemoUser();
  const conversation = await getOrCreateConversation(user.id);
  const events = await listConversationEvents(conversation.id);

  return NextResponse.json({
    conversationId: conversation.id,
    state: conversation.state,
    plan: user.plan,
    messages: events
      .filter((e) => CHAT_TYPES.has(e.type))
      .map((e) => ({
        id: e.id,
        role: e.type === "user_reply" ? "user" : "agent",
        type: e.type,
        text: e.explanation,
        at: e.createdAt,
      })),
  });
}

export async function POST(request: Request) {
  const user = await getDemoUser();

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
    if (existing.length > 0) {
      return NextResponse.json({ skipped: true, reason: "already_started" });
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
