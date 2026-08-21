import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentEvents, type AgentEvent, type AgentEventType } from "@/lib/db/schema";

/**
 * The audit trail writer — PLAN.md §6.6.
 *
 * Everything the agent does, and everything it was stopped from doing, lands
 * here. Refusals are logged as loudly as successes: a bound nobody can see
 * being enforced is indistinguishable from a bound that does not exist.
 */

export type LogEventInput = {
  userId: string;
  conversationId?: string | null;
  type: AgentEventType;
  explanation: string;
  facts?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

export async function logAgentEvent(input: LogEventInput): Promise<AgentEvent> {
  const [row] = await db
    .insert(agentEvents)
    .values({
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      type: input.type,
      explanation: input.explanation,
      facts: input.facts ?? null,
      meta: input.meta ?? null,
    })
    .returning();

  return row;
}

export async function listAgentEvents(
  userId: string,
  limit = 200,
): Promise<AgentEvent[]> {
  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.userId, userId))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(limit);
}

export async function listConversationEvents(
  conversationId: string,
): Promise<AgentEvent[]> {
  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.conversationId, conversationId))
    .orderBy(agentEvents.createdAt, agentEvents.id);
}

export const EVENT_LABELS: Record<AgentEventType, string> = {
  suggestion: "Agent suggestion",
  agent_reply: "Agent reply",
  user_reply: "User reply",
  intent: "Intent classified",
  checkout_created: "Checkout order created",
  checkout_result: "Payment outcome",
  tool_refused: "Tool call refused",
};
