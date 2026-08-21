import { logAgentEvent } from "@/lib/audit";
import type { Conversation, User } from "@/lib/db/schema";
import type { UsageFacts } from "@/lib/facts";
import { createProUpgradeOrder } from "@/lib/razorpay";
import { hasAffirmativeAfterSuggestion, setConversationState } from "./conversation";
import { checkoutReadyTemplate } from "./grounding";

/**
 * The toolset — PLAN.md §6.6.
 *
 * Two tools exist. Nothing else is callable, and the enforcement below runs in
 * the handler rather than in the prompt, because a system prompt asking a model
 * to behave is a request, not a boundary. Every rule here holds even if the
 * model is jailbroken, confused, or replaced tomorrow with a worse one.
 *
 * Rules 3 (one open order) and 5 (already Pro) are enforced one level down in
 * `createProUpgradeOrder`, because they apply to human callers too.
 */

export const TOOL_NAMES = ["explainSuggestion", "createCheckoutOrder"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

export type ToolContext = {
  user: User;
  conversation: Conversation;
  facts: UsageFacts;
};

export type ToolOutcome =
  | { status: "ran"; tool: ToolName; reply?: string; checkout?: CheckoutHandoff }
  | { status: "refused"; tool: string; rule: string; message: string };

export type CheckoutHandoff = {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  reused: boolean;
};

async function refuse(
  ctx: ToolContext,
  tool: string,
  rule: string,
  message: string,
): Promise<ToolOutcome> {
  await logAgentEvent({
    userId: ctx.user.id,
    conversationId: ctx.conversation.id,
    type: "tool_refused",
    explanation: message,
    facts: { rule, tool },
    meta: { rule, tool, enforcedIn: "lib/agent/tools.ts" },
  });

  return { status: "refused", tool, rule, message };
}

/**
 * Tool 1 — explainSuggestion.
 *
 * Marks the conversation as pitched. It does not generate the wording: the text
 * is produced by the turn runner from `facts` and grounding-checked before it
 * is stored, so this tool cannot be used to say something the data does not
 * support.
 */
export async function runExplainSuggestion(
  ctx: ToolContext,
): Promise<ToolOutcome> {
  // Rule 4 — hard stop after a decline. No second pitch, ever.
  if (ctx.conversation.state === "declined") {
    return refuse(
      ctx,
      "explainSuggestion",
      "stopped_after_decline",
      "The user already declined this upgrade, so the agent will not pitch it again in this conversation.",
    );
  }

  if (ctx.conversation.state === "converted" || ctx.user.plan === "pro") {
    return refuse(
      ctx,
      "explainSuggestion",
      "already_pro",
      "This account is already on Pro, so there is nothing to suggest.",
    );
  }

  // Rule 4 — one pitch per session.
  if (ctx.conversation.state === "pitched") {
    return refuse(
      ctx,
      "explainSuggestion",
      "one_pitch_per_session",
      "The upgrade has already been explained once in this conversation. The agent may answer questions but will not re-pitch.",
    );
  }

  await setConversationState(ctx.conversation.id, "pitched");
  return { status: "ran", tool: "explainSuggestion" };
}

/**
 * Tool 2 — createCheckoutOrder.
 *
 * The only tool that can touch money, and the most heavily gated thing in the
 * codebase. Note what it does NOT do: it cannot charge anyone. It prepares an
 * order and hands it back for the user to authorise inside Razorpay's own UI.
 */
export async function runCreateCheckoutOrder(
  ctx: ToolContext,
): Promise<ToolOutcome> {
  // Rule 4 — the user said no.
  if (ctx.conversation.state === "declined") {
    return refuse(
      ctx,
      "createCheckoutOrder",
      "stopped_after_decline",
      "The user declined the upgrade. No checkout may be created in this conversation.",
    );
  }

  // Rule 2 — consent must already be on record, and must postdate the pitch.
  const consented = await hasAffirmativeAfterSuggestion(ctx.conversation.id);
  if (!consented) {
    return refuse(
      ctx,
      "createCheckoutOrder",
      "no_recorded_consent",
      "No explicit yes has been recorded after the upgrade was explained, so the agent may not create a checkout. It asked again instead.",
    );
  }

  const result = await createProUpgradeOrder(ctx.user, {
    initiatedBy: "agent",
    conversationId: ctx.conversation.id,
  });

  if (!result.ok) {
    return { status: "refused", tool: "createCheckoutOrder", rule: result.rule, message: result.message };
  }

  return {
    status: "ran",
    tool: "createCheckoutOrder",
    reply: checkoutReadyTemplate(result.amountPaise),
    checkout: {
      orderId: result.orderId,
      amountPaise: result.amountPaise,
      currency: result.currency,
      keyId: result.keyId,
      reused: result.reused,
    },
  };
}
