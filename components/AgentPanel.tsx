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
export function AgentPanel({
  profile,
  plan,
}: {
  profile: { name: string; email: string };
  plan: "free" | "pro";
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [checkout, setCheckout] = useState<(CheckoutOrder & { reused: boolean }) | null>(null);
  const [proposal, setProposal] = useState<TransactionProposal | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<string | null>(null);
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

  // Load whatever the audit trail already recorded, then let the agent open the
  // conversation if it has not spoken yet.
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
                : "I could not reach my backend just now. The Billing page still works on its own.",
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
          return;
        }

        const turn: TurnResponse = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "start" }),
        }).then((r) => r.json());

        // Another client had already opened the conversation between our
        // history fetch and this call, so render what came back rather than
        // sitting blank.
        if (turn.skipped && Array.isArray(turn.messages)) {
          setMessages(
            turn.messages.map((m) => ({ id: m.id, role: m.role, text: m.text })),
          );
          return;
        }

        if (turn.reply) {
          push({ id: `start-${Date.now()}`, role: "agent", text: turn.reply });
          setMeta(describeTurn(turn));
        }
      } catch {
        push({
          id: "boot-error",
          role: "agent",
          text: "I could not load your account just now. The Billing page still works on its own.",
        });
      } finally {
        setBusy(false);
      }
    })();
  }, [push]);

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
      aria-label="TrackMoney assistant"
      className="flex h-[70dvh] min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-agent" aria-hidden />
          <h2 className="text-sm font-semibold">TrackMoney assistant</h2>
        </div>
        <span className="text-xs text-muted">
          {plan === "pro" ? "Pro account" : "Free account"}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
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
          placeholder="Ask what Pro changes, or say yes to upgrade"
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
