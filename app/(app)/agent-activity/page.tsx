import { SetupNotice } from "@/components/SetupNotice";
import { EVENT_LABELS, listAgentEvents } from "@/lib/audit";
import { computeAgentMetrics, RULE_LABELS } from "@/lib/agent/metrics";
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
    const metrics = computeAgentMetrics(events);

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

        {/*
          The same rows, counted.

          A refusal you can scroll past once is an anecdote. A rate is a
          property of the system, and it is the thing somebody actually wants
          to know after reading two or three rows: does any of this fire, and
          how often. Every figure here is derived from the events above rather
          than recorded separately, so the summary cannot disagree with the
          trail it summarises.
        */}
        {metrics.turns > 0 && (
          <section
            aria-label="What the gates did"
            className="rounded-xl border border-line bg-surface p-4"
          >
            <h2 className="text-sm font-semibold">What the gates did</h2>
            <p className="mt-1 text-xs text-muted">
              Counted from the rows below, over this account&apos;s whole
              history.
            </p>

            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Turns the agent took"
                value={String(metrics.turns)}
              />
              <Stat
                label="Answered by a model"
                value={`${metrics.modelAnswered} of ${metrics.turns}`}
                note={
                  metrics.byProvider.template > 0
                    ? `${metrics.byProvider.template} fell through to templates`
                    : undefined
                }
              />
              <Stat
                label="Wording discarded as ungrounded"
                value={
                  metrics.groundingRejectionRate === null
                    ? "n/a"
                    : `${(metrics.groundingRejectionRate * 100).toFixed(1)}%`
                }
                note={
                  metrics.groundingRejectionRate === null
                    ? "no model has answered yet"
                    : `${metrics.fellBackToTemplate} of ${metrics.modelAnswered} model replies`
                }
                tone={metrics.fellBackToTemplate > 0 ? "agent" : undefined}
              />
              {/*
                Deliberately not repeating the tally above. That one counts
                refusals; this is the share of attempts that were refused,
                which is the figure that says whether the gates are load
                bearing or decorative.
              */}
              <Stat
                label="Refusal rate"
                value={
                  metrics.toolsRequested + metrics.toolsRefused > 0
                    ? `${metrics.toolsRefused} of ${
                        metrics.toolsRequested + metrics.toolsRefused
                      }`
                    : "none attempted"
                }
                tone={metrics.toolsRefused > 0 ? "agent" : undefined}
              />
              {metrics.tokens && (
                <Stat
                  label="Tokens spent"
                  value={metrics.tokens.total.toLocaleString("en-IN")}
                  note={
                    metrics.tokens.unaccounted > 0
                      ? `${metrics.tokens.prompt.toLocaleString("en-IN")} in, ${metrics.tokens.completion.toLocaleString("en-IN")} out, ${metrics.tokens.unaccounted.toLocaleString("en-IN")} the model reasoned with`
                      : `${metrics.tokens.prompt.toLocaleString("en-IN")} in, ${metrics.tokens.completion.toLocaleString("en-IN")} out`
                  }
                />
              )}
            </dl>

            {metrics.refusalsByRule.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted">
                  Why calls were refused
                </p>
                <ul className="mt-1.5 space-y-1">
                  {metrics.refusalsByRule.map(({ rule, count }) => (
                    <li key={rule} className="text-xs text-muted">
                      <span className="font-mono tabular text-ink">
                        {count}
                      </span>{" "}
                      {RULE_LABELS[rule] ?? rule}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {metrics.ungroundedSamples.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted">
                  Figures the grounding check threw away
                </p>
                <p className="mt-1.5 font-mono text-xs text-bad">
                  {metrics.ungroundedSamples.join("  ·  ")}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Each of these was in a sentence a model wrote, and in none of
                  the facts it was given. None of them reached the account.
                </p>
              </div>
            )}
          </section>
        )}

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
                    <summary className="inline-flex min-h-6 cursor-pointer list-none items-center font-mono text-[11px] text-muted underline-offset-2 hover:underline">
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

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "agent";
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-lg tabular ${
          tone === "agent" ? "text-agent" : "text-ink"
        }`}
      >
        {value}
      </dd>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

const BADGE_STYLES: Record<AgentEventType, string> = {
  suggestion: "bg-agent-tint text-agent",
  agent_reply: "bg-agent-tint text-agent",
  user_reply: "bg-brand-tint text-brand-strong",
  intent: "bg-brand-tint text-brand-strong",
  checkout_created: "bg-brand-tint text-brand-strong",
  checkout_result: "bg-brand-tint text-ok",
  tool_refused: "bg-agent-tint text-bad",
  notification_opened: "bg-agent-tint text-agent",
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
