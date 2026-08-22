import { and, desc, eq } from "drizzle-orm";

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

/**
 * Which conversation, if any, handed this order to the user.
 *
 * Attribution cannot be read off `payments.initiatedBy` alone: an order started
 * on the Billing page and then handed over by the agent (rule 3 reuses the open
 * order) was genuinely paid through the agent's button, and the chat needs to
 * learn how it ended. The audit trail already records exactly that — a
 * `checkout_created` row carrying the order id and the conversation it was
 * offered in — so the trail is the honest source for this, not a flag.
 */
export async function conversationForOrder(
  userId: string,
  orderId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      conversationId: agentEvents.conversationId,
      meta: agentEvents.meta,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.userId, userId),
        eq(agentEvents.type, "checkout_created"),
      ),
    )
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id));

  for (const row of rows) {
    if (!row.conversationId) continue;
    if ((row.meta as { orderId?: string } | null)?.orderId === orderId) {
      return row.conversationId;
    }
  }

  return null;
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
