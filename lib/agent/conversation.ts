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
 *
 * It must also postdate the last order this conversation created. One yes
 * authorises one checkout — otherwise a single agreement kept authorising new
 * orders for the life of the conversation, so a failed payment could be
 * followed by a fresh order the user never asked for.
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
        inArray(agentEvents.type, [
          "suggestion",
          "agent_reply",
          "intent",
          "checkout_created",
        ]),
      ),
    )
    .orderBy(agentEvents.createdAt, agentEvents.id);

  /**
   * Was the upgrade explained here, whether as a pitch or as an answer?
   *
   * Both end by asking for a yes, so both are something a yes can refer to.
   * Counting only the pitch left anyone who asked about Pro before being
   * offered it unable to buy at all.
   */
  const explains = (row: (typeof rows)[number]) =>
    row.type === "suggestion" ||
    (row.type === "agent_reply" &&
      (row.meta as { explainedUpgrade?: boolean } | null)?.explainedUpgrade === true);

  let consentIsLive = false;
  for (const row of rows) {
    if (row.type === "suggestion" || row.type === "agent_reply") continue;

    // Creating an order spends the consent that authorised it.
    if (row.type === "checkout_created") {
      consentIsLive = false;
      continue;
    }

    const intent = (row.meta as { intent?: string } | null)?.intent;
    if (intent === "affirmative") {
      // Only counts once something has been explained to agree to.
      consentIsLive = rows.some(
        (r) =>
          explains(r) &&
          (r.createdAt < row.createdAt ||
            (r.createdAt.getTime() === row.createdAt.getTime() && r.id < row.id)),
      );
    }
  }

  return consentIsLive;
}

/**
 * Is there a drafted transaction still waiting to be confirmed?
 *
 * This exists to stop a yes-or-no being applied to the wrong subject. The
 * classifier was written when the upgrade was the only thing a person could
 * agree to, so every "no" was read as declining the sale. Drafting added a
 * second thing to say no to, and the two are not interchangeable: "no, it was
 * 450 not 4500" is somebody correcting a draft, and it was being recorded as a
 * permanent refusal of an upgrade they had not been offered — unrecoverable,
 * because a conversation only moves out of "declined" by starting a new one.
 *
 * A draft is pending when the newest thing the agent said was a draft. Anything
 * later — a confirmation, another answer — means the card is gone and a no is
 * about the sale again.
 */
export async function hasPendingDraft(conversationId: string): Promise<boolean> {
  const [latest] = await db
    .select()
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.conversationId, conversationId),
        inArray(agentEvents.type, ["suggestion", "agent_reply"]),
      ),
    )
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(1);

  const meta = latest?.meta as { stage?: string } | null | undefined;
  return meta?.stage === "drafted";
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
