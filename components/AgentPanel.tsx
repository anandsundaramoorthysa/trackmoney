"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { openCheckout, type CheckoutOrder } from "@/lib/checkout-client";
import { confirmProposalAction } from "@/lib/agent/confirm-actions";
import { CATEGORIES } from "@/lib/categories";
import type { TransactionProposal } from "@/lib/agent/proposal";

type Message = {
  id: string;
  role: "user" | "agent";
  text: string;
  pending?: boolean;
};

type HistoryMessage = { id: string; role: Message["role"]; text: string };

type TurnResponse = {
  reply: string;
  explaining?: { id: string; title: string };
  state?: string;
  skipped?: boolean;
  messages?: HistoryMessage[];
  provider: string;
  checkout: (CheckoutOrder & { reused: boolean }) | null;
  proposal: TransactionProposal | null;
  toolRequested: string;
  toolOutcome: string;
  grounding: string;
};

/**
 * The agent conversation.
 *
 * Note what this panel does when the agent prepares an order: it renders a
 * separate button and stops. The agent cannot open Razorpay's checkout and
 * cannot complete a payment; a person has to do both.
 *
 * The height is tied to the viewport rather than fixed in pixels because this
 * is now the whole of its own page: on a laptop that is roughly what a fixed
 * 560px gave, and on a tall monitor it uses the room instead of leaving a gap
 * under the last message. The floor keeps a few turns visible on a short one.
 */
/**
 * Four things somebody can actually ask, as buttons that fill the box.
 *
 * They fill rather than send. Editing before committing is the point — one of
 * these is a route to a checkout, and turning a single click into a turn the
 * person did not compose is exactly the shape this whole change is removing.
 *
 * Static strings, deliberately. A personalised example would be a claim about
 * somebody's money rendered before any grounding check has run.
 */
const EXAMPLES = [
  "What did I spend on Food & Drink this month?",
  "I spent 200 on coffee",
  "How close am I to my monthly cap?",
  "What does Pro include?",
];

export function AgentPanel({
  profile,
  plan,
  explainId,
}: {
  profile: { name: string; email: string };
  plan: "free" | "pro";
  /** Set when the person arrived by opening a notification. */
  explainId?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [checkout, setCheckout] = useState<(CheckoutOrder & { reused: boolean }) | null>(null);
  const [proposal, setProposal] = useState<TransactionProposal | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [explaining, setExplaining] = useState<string | null>(null);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, checkout]);

  /**
   * Load what the trail already recorded — and nothing else.
   *
   * The agent used to speak here, unprompted, the moment the page mounted. It
   * does not any more: this is a place to ask things, and what it notices on
   * its own goes to the bell. The only turn that can start without the person
   * typing is one they asked for by opening a notification.
   */
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/agent");
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          push({
            id: "setup",
            role: "agent",
            text:
              problem.setupRequired && problem.error
                ? `I am not set up yet — ${problem.error}`
                : "I could not read your account just now. The Billing page still works on its own.",
          });
          return;
        }

        const history = await response.json();
        if (history.checkout) setCheckout(history.checkout);
        if (Array.isArray(history.messages) && history.messages.length > 0) {
          setMessages(
            history.messages.map((m: HistoryMessage) => ({
              id: m.id,
              role: m.role,
              text: m.text,
            })),
          );
        }

        if (!explainId) return;

        const turn: TurnResponse = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "explain", notificationId: explainId }),
        }).then((r) => r.json());

        // Already explained — a refresh, a second tab, or a development
        // double-mount. Render what is on the record rather than asking again;
        // the upgrade explanation records a pitch and must not record two.
        if (turn.skipped && Array.isArray(turn.messages)) {
          setMessages(
            turn.messages.map((m) => ({ id: m.id, role: m.role, text: m.text })),
          );
        } else if (turn.reply) {
          push({ id: `explain-${Date.now()}`, role: "agent", text: turn.reply });
          setMeta(describeTurn(turn));
          if (turn.checkout) setCheckout(turn.checkout);
        }

        if (turn.explaining?.title) setExplaining(turn.explaining.title);

        // Drop the parameter so a reload is not a second request to explain.
        router.replace("/assistant");
      } catch {
        push({
          id: "boot-error",
          role: "agent",
          text: "I could not load your account just now. The Billing page still works on its own.",
        });
      } finally {
        setBusy(false);
        setReady(true);
      }
    })();
  }, [push, explainId, router]);

  async function send(text: string) {
    if (!text.trim() || busy) return;

    setInput("");
    push({ id: `u-${Date.now()}`, role: "user", text });
    setBusy(true);

    try {
      const turn: TurnResponse = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      }).then((r) => r.json());

      push({ id: `a-${Date.now()}`, role: "agent", text: turn.reply });
      setMeta(describeTurn(turn));
      if (turn.checkout) setCheckout(turn.checkout);
      // A draft replaces whatever was on the card before, so an older
      // suggestion cannot be confirmed by someone who has moved on.
      setProposal(turn.proposal ?? null);
      // Once the user has said no, the offer goes with it. Leaving the button
      // under "I will not bring this up again" would contradict the sentence
      // directly above it.
      if (turn.state === "declined") setCheckout(null);
      router.refresh();
    } catch {
      push({
        id: `err-${Date.now()}`,
        role: "agent",
        text: "Something went wrong on my side. Nothing was charged.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    if (!checkout) return;
    setBusy(true);
    try {
      const result = await openCheckout(checkout, profile);
      if (result.outcome === "success") {
        setCheckout(null);
        push({
          id: `ok-${Date.now()}`,
          role: "agent",
          text: "Payment verified — your account is on Pro now. The full trail is on the Agent activity page.",
        });
      } else if (result.outcome === "failed") {
        setCheckout(null);
        push({
          id: `fail-${Date.now()}`,
          role: "agent",
          text: `That payment did not go through — ${result.reason} You are still on Free and nothing was charged. You can try again from the Billing page whenever you want.`,
        });
      } else if (result.outcome === "unavailable") {
        // The order stands: the window failed to open, so there is nothing to
        // withdraw and the handoff is left in place to try again.
        push({
          id: `unavailable-${Date.now()}`,
          role: "agent",
          text: `Razorpay's checkout would not open — ${result.reason} The order is still prepared, so you can try the button again or use the Billing page.`,
        });
      } else {
        push({
          id: `dismiss-${Date.now()}`,
          role: "agent",
          text: "You closed the checkout, so nothing was charged. The order is still open if you change your mind.",
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Tracky AI"
      /*
       * Proof the client is running, for anything that needs to wait for it.
       * The tests used to wait for the agent's first message as a stand-in, and
       * with no first message that stand-in would have silently passed on
       * server-rendered markup. This is set in the mount effect's own finally,
       * so it cannot be satisfied by HTML alone.
       */
      data-ready={ready ? "true" : undefined}
      className="flex h-[70dvh] min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-agent" aria-hidden />
          <h2 className="text-sm font-semibold">Tracky AI</h2>
        </div>
        <span className="text-xs text-muted">
          {plan === "pro" ? "Pro account" : "Free account"}
        </span>
      </header>

      {explaining && (
        <p className="border-b border-line bg-agent-tint px-4 py-2 text-xs text-muted">
          Explaining: {explaining}
        </p>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/*
          The empty state. Not a box, and deliberately not a pitch — the last
          clause is doing real work, because it tells somebody where the thing
          that used to greet them went.
        */}
        {ready && messages.length === 0 && !proposal && (
          <div className="space-y-3">
            <p className="max-w-[85%] rounded-2xl rounded-bl-sm border border-line bg-agent-tint px-3.5 py-2.5 text-sm text-ink">
              Ask me about your spending, or tell me what you spent and I will
              draft it for you to confirm. Anything I notice on my own goes to
              the bell, not here.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-brand-tint hover:text-ink"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              /*
               * Marks a real turn in the conversation, as distinct from the
               * empty state — which is deliberately styled like an agent bubble
               * so the page does not open with a bare box. Without this the two
               * are indistinguishable to anything reading the DOM, and a test
               * asking "has the agent spoken?" answers yes when it has not.
               */
              data-message-role={m.role}
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2.5 text-sm text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm border border-line bg-agent-tint px-3.5 py-2.5 text-sm text-ink"
              }
            >
              {m.text}
            </p>
          </div>
        ))}

        {proposal && (
          <form
            action={async (form: FormData) => {
              const result = await confirmProposalAction(form);
              setProposal(null);
              setMessages((prev) => [
                ...prev,
                {
                  id: `confirm-${Date.now()}`,
                  role: "agent" as const,
                  text: result.message,
                },
              ]);
            }}
            className="rounded-xl border border-agent/40 bg-agent-tint p-3.5"
          >
            <p className="text-xs text-muted">
              Drafted, not saved. Change anything before confirming.
            </p>

            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Merchant</span>
                <input
                  name="merchant"
                  defaultValue={proposal.merchant}
                  required
                  maxLength={80}
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Amount (₹)</span>
                <input
                  name="amount"
                  defaultValue={(proposal.amountPaise / 100).toFixed(2)}
                  required
                  inputMode="decimal"
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Category</span>
                <select
                  name="category"
                  defaultValue={proposal.category}
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Date</span>
                <input
                  name="occurredOn"
                  type="date"
                  defaultValue={proposal.occurredOn}
                  required
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-sm"
                />
              </label>
            </div>

            <div className="mt-2.5 flex gap-2">
              <button
                type="submit"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
              >
                Save this
              </button>
              <button
                type="button"
                onClick={() => setProposal(null)}
                className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
              >
                Discard
              </button>
            </div>
          </form>
        )}

        {checkout && (
          <div className="rounded-xl border border-agent/40 bg-agent-tint p-3.5">
            <p className="text-xs text-muted">
              Order {checkout.orderId} · Razorpay test mode
              {checkout.reused ? " · reused the existing open order" : ""}
            </p>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={busy}
              className="mt-2.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              Open secure checkout
            </button>
          </div>
        )}

        {busy && <p className="text-xs text-muted">Working…</p>}
      </div>

      {meta && (
        <p className="border-t border-line px-4 py-2 font-mono text-[11px] text-muted">
          {meta}
        </p>
      )}

      <form
        className="flex items-center gap-2 border-t border-line px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your spending, or tell me what you spent"
          maxLength={500}
          className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition-colors hover:bg-brand-tint disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}

/** Surfaced in the UI so the mechanics are visible during a live demo. */
function describeTurn(turn: TurnResponse): string {
  const parts = [`provider: ${turn.provider}`, `tool: ${turn.toolRequested}`];
  if (turn.toolOutcome !== "not_requested") parts.push(turn.toolOutcome);
  parts.push(`grounding: ${turn.grounding}`);
  return parts.join("  ·  ");
}
