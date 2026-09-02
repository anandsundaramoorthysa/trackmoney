import { SetupNotice } from "@/components/SetupNotice";
import { EVENT_LABELS, listAgentEvents } from "@/lib/audit";
import type { AgentEventType } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { formatTimestamp } from "@/lib/time";

export const dynamic = "force-dynamic";

/** How many rows the page shows before it admits there are more. */
const TRAIL_LIMIT = 200;

/**
 * The audit trail.
 *
 * Deliberately a log, not a chat transcript. Every row is one thing the agent
 * did or was stopped from doing, in order, with the exact facts it was working
 * from expandable underneath. Refusals appear here as prominently as successes.
 */
export default async function AgentActivityPage() {
  try {
    const user = await requireUser();
    // One more than shown, so the page can say when it is not showing all of it
    // rather than quietly starting halfway through the story.
    const fetched = await listAgentEvents(user.id, TRAIL_LIMIT + 1);
    const truncated = fetched.length > TRAIL_LIMIT;
    const events = truncated ? fetched.slice(0, TRAIL_LIMIT) : fetched;

    const refusals = events.filter((e) => e.type === "tool_refused").length;

    // A reused order and a failed API call are not money actions — one is a
    // deduplicated no-op and the other never reached Razorpay. Counting them
    // made the rule that *prevents* extra money actions increment the
    // money-action tally.
    const moneyActions = events.filter(
      (e) =>
        (e.type === "checkout_created" || e.type === "checkout_result") &&
        (e.meta as { moneyMoved?: boolean } | null)?.moneyMoved !== false,
    ).length;

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Agent activity
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Every money action on this account, newest first: what the agent
            noticed, what it said, how the reply was read, what it created, what
            it was refused, and how the payment ended. Payments started from the
            Billing page appear here too, marked as yours rather than the
            agent&apos;s — the point of the page is that both go through the same
            gate. Expand a row to see the exact numbers the agent was given when
            it spoke, which is what makes the wording checkable rather than
            merely plausible.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <Tally
            label={truncated ? `Events (latest ${TRAIL_LIMIT})` : "Events"}
            value={events.length}
          />
          <Tally label="Money actions" value={moneyActions} />
          <Tally label="Tool calls refused" value={refusals} tone="agent" />
        </div>

        {events.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-muted">
            Nothing yet. Open the assistant and talk to it.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {events.map((event) => (
              <li
                key={event.id}
                className="border-b border-line/70 px-4 py-3 last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-muted tabular">
                    {formatTimestamp(event.createdAt)}
                  </span>
                  <TypeBadge type={event.type} meta={event.meta} />
                  <Initiator meta={event.meta} />
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
          </ul>
        )}

        {truncated && (
          <p className="text-xs text-muted">
            Showing the most recent {TRAIL_LIMIT} events. Older ones are still
            recorded — reset the demo data to start a clean trail.
          </p>
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

/**
 * The label has to describe what happened, not just which code path ran. A
 * failed Orders API call is not a payment outcome, and reusing an open order is
 * not a checkout being created.
 */
function labelFor(
  type: AgentEventType,
  meta: Record<string, unknown> | null,
): string {
  const outcome = (meta as { outcome?: string } | null)?.outcome;
  if (outcome === "order_creation_failed") return "Order could not be created";
  if (outcome === "unknown_order") return "Unrecognised payment";
  if (outcome === "late_failure_ignored") return "Late failure ignored";
  if ((meta as { reused?: boolean } | null)?.reused === true) {
    return "Existing order reused";
  }
  return EVENT_LABELS[type] ?? type;
}

function TypeBadge({
  type,
  meta,
}: {
  type: AgentEventType;
  meta: Record<string, unknown> | null;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${BADGE_STYLES[type] ?? "bg-brand-tint"}`}
    >
      {labelFor(type, meta)}
    </span>
  );
}

/** Who set this in motion — the agent, or a person clicking Billing. */
function Initiator({ meta }: { meta: Record<string, unknown> | null }) {
  const by = (meta as { initiatedBy?: string } | null)?.initiatedBy;
  if (by !== "agent" && by !== "billing_page" && by !== "ai_buyer") return null;

  const label =
    by === "agent"
      ? "started by the agent"
      : by === "ai_buyer"
        ? "started by an AI buyer, on your mandate"
        : "started by you, on Billing";

  return (
    <span
      className={`font-mono text-[11px] ${
        by === "billing_page" ? "text-muted" : "text-agent"
      }`}
    >
      {label}
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
