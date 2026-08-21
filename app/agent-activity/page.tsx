import { SetupNotice } from "@/components/SetupNotice";
import { EVENT_LABELS, listAgentEvents } from "@/lib/audit";
import type { AgentEventType } from "@/lib/db/schema";
import { getDemoUser } from "@/lib/demo";
import { formatTimestamp } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The audit trail — PLAN.md §2 step 7.
 *
 * Deliberately a log, not a chat transcript. Every row is one thing the agent
 * did or was stopped from doing, in order, with the exact facts it was working
 * from expandable underneath. Refusals appear here as prominently as successes.
 */
export default async function AgentActivityPage() {
  try {
    const user = await getDemoUser();
    const events = await listAgentEvents(user.id);

    const refusals = events.filter((e) => e.type === "tool_refused").length;
    const moneyActions = events.filter(
      (e) => e.type === "checkout_created" || e.type === "checkout_result",
    ).length;

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Agent activity
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Every action the agent took, in order: what it noticed, what it said,
            how the reply was read, what it created, and how the payment ended.
            Expand a row to see the exact numbers it was given when it spoke —
            that is what makes the wording checkable rather than merely
            plausible.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <Tally label="Events" value={events.length} />
          <Tally label="Money actions" value={moneyActions} />
          <Tally label="Tool calls refused" value={refusals} tone="agent" />
        </div>

        {events.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-muted">
            Nothing yet. Open the dashboard and talk to the assistant.
          </p>
        ) : (
          <ol className="overflow-hidden rounded-xl border border-line bg-surface">
            {events.map((event) => (
              <li
                key={event.id}
                className="border-b border-line/70 px-4 py-3 last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-muted tabular">
                    {formatTimestamp(event.createdAt)}
                  </span>
                  <TypeBadge type={event.type} />
                </div>
                <p className="mt-1.5 text-sm">{event.explanation}</p>

                {(event.facts || event.meta) && (
                  <details className="mt-2 group">
                    <summary className="cursor-pointer list-none font-mono text-[11px] text-muted underline-offset-2 hover:underline">
                      show the data behind this row
                    </summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {event.facts && (
                        <Payload title="facts the agent was given" value={event.facts} />
                      )}
                      {event.meta && <Payload title="how it was handled" value={event.meta} />}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  } catch (error) {
    return <SetupNotice error={error} />;
  }
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "agent";
}) {
  return (
    <span className="rounded-lg border border-line bg-surface px-3 py-1.5">
      <span className="text-muted">{label} </span>
      <span
        className={`font-mono tabular ${tone === "agent" ? "text-agent" : ""}`}
      >
        {value}
      </span>
    </span>
  );
}

const BADGE_STYLES: Record<AgentEventType, string> = {
  suggestion: "bg-agent-tint text-agent",
  agent_reply: "bg-agent-tint text-agent",
  user_reply: "bg-brand-tint text-brand",
  intent: "bg-brand-tint text-brand",
  checkout_created: "bg-brand-tint text-brand",
  checkout_result: "bg-brand-tint text-ok",
  tool_refused: "bg-agent-tint text-bad",
};

function TypeBadge({ type }: { type: AgentEventType }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${BADGE_STYLES[type] ?? "bg-brand-tint"}`}
    >
      {EVENT_LABELS[type] ?? type}
    </span>
  );
}

function Payload({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-2.5">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
        {title}
      </p>
      <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
