import type { AgentEvent } from "@/lib/db/schema";

/**
 * What the gates actually did, counted.
 *
 * The audit page already shows every row. This reads the same rows and answers
 * the question a reader has after scrolling a few of them: how often does any
 * of this fire? A refusal you can see once is an anecdote; a refusal rate is a
 * property.
 *
 * Everything here is derived from `meta` that `runAgentTurn` already writes.
 * Nothing new is recorded to produce it, which matters: a metric that needs its
 * own logging is a metric that can disagree with the trail it claims to
 * summarise.
 */

export type AgentMetrics = {
  turns: number;
  /** Generations discarded because a figure was not in the facts. */
  fellBackToTemplate: number;
  /** As a share of turns where a model actually answered. */
  groundingRejectionRate: number | null;
  modelAnswered: number;
  byProvider: { groq: number; gemini: number; template: number };
  toolsRequested: number;
  toolsRefused: number;
  refusalsByRule: Array<{ rule: string; count: number }>;
  /** Distinct figures the grounding check has thrown away. */
  ungroundedSamples: string[];
  /**
   * Tokens the providers reported, summed. Null when none reported any, which
   * is different from zero: zero would claim the turns were free.
   */
  tokens: { prompt: number; completion: number; total: number } | null;
};

function metaOf(event: AgentEvent): Record<string, unknown> {
  return (event.meta as Record<string, unknown> | null) ?? {};
}

export function computeAgentMetrics(events: AgentEvent[]): AgentMetrics {
  const byProvider = { groq: 0, gemini: 0, template: 0 };
  const rules = new Map<string, number>();
  const ungrounded = new Set<string>();

  let turns = 0;
  let fellBack = 0;
  let tokensSeen = false;
  const tokens = { prompt: 0, completion: 0, total: 0 };
  let toolsRequested = 0;
  let toolsRefused = 0;

  for (const event of events) {
    const meta = metaOf(event);

    if (event.type === "tool_refused") {
      toolsRefused++;
      const rule = typeof meta.rule === "string" ? meta.rule : "unspecified";
      rules.set(rule, (rules.get(rule) ?? 0) + 1);
      continue;
    }

    if (event.type !== "agent_reply" && event.type !== "suggestion") continue;

    turns++;

    const provider = meta.provider;
    if (provider === "groq") byProvider.groq++;
    else if (provider === "gemini") byProvider.gemini++;
    else byProvider.template++;

    if (meta.grounding === "fell_back_to_template") fellBack++;

    if (typeof meta.toolRequested === "string" && meta.toolRequested !== "none") {
      toolsRequested++;
    }

    const t = meta.tokens as
      | { prompt?: number; completion?: number; total?: number }
      | undefined;
    if (t && typeof t.total === "number") {
      tokensSeen = true;
      tokens.prompt += t.prompt ?? 0;
      tokens.completion += t.completion ?? 0;
      tokens.total += t.total;
    }

    if (Array.isArray(meta.ungroundedNumbers)) {
      for (const n of meta.ungroundedNumbers) {
        if (typeof n === "string") ungrounded.add(n);
      }
    }
  }

  /**
   * The denominator is turns a model actually answered, not all turns.
   *
   * Counting template turns in it would make the rate fall every time a
   * provider was down, which reads as the checks getting better precisely when
   * no model is being checked at all.
   */
  const modelAnswered = byProvider.groq + byProvider.gemini;

  return {
    turns,
    fellBackToTemplate: fellBack,
    modelAnswered,
    groundingRejectionRate:
      modelAnswered > 0 ? fellBack / modelAnswered : null,
    byProvider,
    toolsRequested,
    toolsRefused,
    refusalsByRule: [...rules.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count),
    ungroundedSamples: [...ungrounded].slice(0, 8),
    tokens: tokensSeen ? tokens : null,
  };
}

/** Rules, in words, for a reader who has not read the code. */
export const RULE_LABELS: Record<string, string> = {
  closed_toolset: "asked for a tool that does not exist",
  no_recorded_consent: "tried to create an order without a recorded yes",
  stopped_after_decline: "tried to sell after a decline",
  already_pro: "tried to charge an account that already pays",
  one_open_order: "tried to open a second order",
  notification_failed_gate: "a notification failed its own checks",
  unreadable_draft: "sent a draft that could not be read",
  mandate_spent: "presented a mandate that was already used",
};
