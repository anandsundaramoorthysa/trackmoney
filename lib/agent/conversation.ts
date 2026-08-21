import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  agentEvents,
  conversations,
  type AgentEvent,
  type Conversation,
} from "@/lib/db/schema";

/** One conversation per demo session. State drives the bounding rules. */
export async function getOrCreateConversation(
  userId: string,
): Promise<Conversation> {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({ userId })
    .returning();

  return created;
}

export async function setConversationState(
  id: string,
  state: Conversation["state"],
): Promise<void> {
  await db.update(conversations).set({ state }).where(eq(conversations.id, id));
}

/**
 * Rule 2 depends on ordering, not just presence: consent only counts if it came
 * *after* the agent explained what it was asking for. A yes recorded before any
 * pitch existed is not consent to anything.
 */
export async function hasAffirmativeAfterSuggestion(
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .select({
      type: agentEvents.type,
      meta: agentEvents.meta,
      createdAt: agentEvents.createdAt,
      id: agentEvents.id,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.conversationId, conversationId),
        inArray(agentEvents.type, ["suggestion", "intent"]),
      ),
    )
    .orderBy(agentEvents.createdAt, agentEvents.id);

  let sawSuggestion = false;
  for (const row of rows) {
    if (row.type === "suggestion") {
      sawSuggestion = true;
      continue;
    }
    if (
      row.type === "intent" &&
      sawSuggestion &&
      (row.meta as { intent?: string } | null)?.intent === "affirmative"
    ) {
      return true;
    }
  }

  return false;
}

export async function transcript(
  conversationId: string,
  limit = 12,
): Promise<AgentEvent[]> {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.conversationId, conversationId),
        inArray(agentEvents.type, [
          "suggestion",
          "agent_reply",
          "user_reply",
          "checkout_created",
          "checkout_result",
        ]),
      ),
    )
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(limit);

  return rows.reverse();
}
