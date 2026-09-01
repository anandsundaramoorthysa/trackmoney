"use client";

/**
 * Browser-side checkout handoff
 *
 * Checkout.js only runs in the browser, so the agent structurally cannot open
 * it. It can prepare an order; a person has to open this and authorise the
 * payment inside Razorpay's own window. That is the third of the three gates
 * between a suggestion and money moving.
 */

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Checkout.js failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Checkout.js failed to load"));
    document.body.appendChild(script);
  });
}

export type CheckoutOrder = {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
};

export type CheckoutResult =
  | { outcome: "success"; amountPaise: number }
  | { outcome: "failed"; reason: string }
  | { outcome: "dismissed" };

export async function openCheckout(
  order: CheckoutOrder,
  profile: { name: string; email: string },
): Promise<CheckoutResult> {
  await loadCheckoutScript();

  const RazorpayCtor = window.Razorpay;
  if (!RazorpayCtor) {
    throw new Error("Razorpay checkout is unavailable.");
  }

  return new Promise<CheckoutResult>((resolve) => {
    let settled = false;
    const settle = (result: CheckoutResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const rzp = new RazorpayCtor({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: "TrackMoney",
      description: "Pro upgrade (one-time)",
      order_id: order.orderId,
      prefill: { name: profile.name, email: profile.email },
      theme: { color: "#0E7C7B" },
      handler: async (response: RazorpaySuccess) => {
        // The browser saying "it worked" is not evidence. The server
        // recomputes the signature before anything changes.
        const verified = await fetch("/api/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(response),
        });

        if (verified.ok) {
          const data = (await verified.json()) as { amountPaise: number };
          settle({ outcome: "success", amountPaise: data.amountPaise });
        } else {
          const data = (await verified.json().catch(() => ({}))) as {
            error?: string;
          };
          settle({
            outcome: "failed",
            reason: data.error ?? "the payment could not be verified.",
          });
        }
      },
      modal: {
        ondismiss: () => settle({ outcome: "dismissed" }),
      },
    } as Record<string, unknown>);

    rzp.on("payment.failed", async (payload: unknown) => {
      const description =
        (payload as { error?: { description?: string } })?.error?.description ??
        "Razorpay reported the payment as failed.";

      await fetch("/api/checkout/failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, reason: description }),
      });

      settle({ outcome: "failed", reason: description });
    });

    rzp.open();
  });
}
