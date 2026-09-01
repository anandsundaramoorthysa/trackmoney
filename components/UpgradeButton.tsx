"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { openCheckout } from "@/lib/checkout-client";

/**
 * The plain, non-agent upgrade path.
 *
 * This button exists for two reasons. A real product always has a manual way to
 * pay, so making the chat the only route would look staged. And because this
 * button and the agent's tool call the same backend function, the agent can be
 * shown to have no special payment privilege — it triggers the same gated
 * endpoint a person clicking here would.
 *
 * It is also the fallback if the model misbehaves live: checkout still works on
 * its own.
 */
export function UpgradeButton({
  profile,
  plan,
  disabled,
}: {
  profile: { name: string; email: string };
  plan: "free" | "pro";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "bad" | "muted">("muted");

  async function handleClick() {
    setBusy(true);
    setStatus(null);

    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        setTone("bad");
        setStatus(data.error ?? "Could not create the order.");
        return;
      }

      const result = await openCheckout(data, profile);

      if (result.outcome === "success") {
        setTone("ok");
        setStatus("Payment verified. You are on Pro.");
        router.refresh();
      } else if (result.outcome === "failed") {
        setTone("bad");
        setStatus(`Payment failed — ${result.reason} Your plan is unchanged.`);
        router.refresh();
      } else {
        setTone("muted");
        setStatus("Checkout closed. Nothing was charged.");
      }
    } catch (error) {
      setTone("bad");
      setStatus(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  // This component owns the outcome message, so it must stay mounted across the
  // refresh that flips the account to Pro. Rendering the "already on Pro" state
  // here rather than swapping the whole component out is what stops a
  // successful payment's confirmation from vanishing the instant it succeeds.
  return (
    <div className="space-y-2">
      {plan === "pro" ? (
        <p className="text-sm text-ok">You are on Pro.</p>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={busy || disabled}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Opening checkout…" : "Upgrade to Pro"}
        </button>
      )}
      {status && (
        <p
          className={`text-sm ${
            tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-muted"
          }`}
        >
          {status}
        </p>
      )}
    </div>
  );
}
