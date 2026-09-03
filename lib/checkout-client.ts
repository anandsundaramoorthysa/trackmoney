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
  | { outcome: "dismissed" }
  /** Checkout never opened. Nothing was attempted and nothing was charged. */
  | { outcome: "unavailable"; reason: string };

/**
 * How long to wait for Razorpay's window to appear.
 *
 * There is no "open failed" event to listen for. When Checkout.js cannot start
 * — its preferences call answering 400 is one way — it shows a browser alert of
 * its own and our promise is left waiting for a handler that will never fire,
 * so the button sits on "Opening checkout…" until the page is reloaded.
 *
 * Generous, because a slow connection opening the modal is normal and being
 * told the checkout is unavailable when it was merely slow would be worse than
 * the wait.
 */
const OPEN_WATCHDOG_MS = 20_000;

/** How often to look for the modal while the deadline is still running. */
const OPEN_POLL_MS = 250;

/**
 * Is Razorpay's window actually on the page?
 *
 * Checkout.js mounts a container and an iframe of its own. Any of these
 * appearing is proof the handoff happened; which one it is does not matter, so
 * the check stays loose rather than pinned to a single class name we do not own
 * and cannot keep up to date.
 */
function checkoutIsOnScreen(): boolean {
  return Boolean(
    document.querySelector(
      '.razorpay-container, .razorpay-checkout-frame, iframe[src*="razorpay"]',
    ),
  );
}

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
    // A holder rather than a bare let: it is assigned once, after the settle
    // function that has to be able to clear it.
    const timers: { watchdog?: ReturnType<typeof setTimeout> } = {};
    const nativeAlert = window.alert;

    const settle = (result: CheckoutResult) => {
      if (settled) return;
      settled = true;
      if (timers.watchdog) clearTimeout(timers.watchdog);
      // Always put the browser's own alert back, whichever way this ended.
      window.alert = nativeAlert;
      resolve(result);
    };

    /**
     * Catch Razorpay's alert and answer it on the page instead.
     *
     * Checkout.js reports "Error in opening checkout" through `window.alert`.
     * A modal browser dialog on a payment screen is the wrong medium on its own
     * terms — it cannot be styled, read by the page, or dismissed by anything
     * automated, and it tells the person nothing about what to do next. It is
     * borrowed for the duration of the handoff and given straight back.
     */
    window.alert = (message?: unknown) => {
      settle({
        outcome: "unavailable",
        reason:
          typeof message === "string" && message.trim()
            ? message.trim()
            : "Razorpay could not open the checkout window.",
      });
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

    /**
     * Opening can fail synchronously, or fail by never doing anything.
     *
     * Both leave the caller waiting forever without this: the first throws past
     * the promise, and the second simply never calls a handler.
     */
    try {
      rzp.open();
    } catch (error) {
      settle({
        outcome: "unavailable",
        reason:
          error instanceof Error && error.message
            ? error.message
            : "Razorpay could not open the checkout window.",
      });
      return;
    }

    /**
     * Watch for the window, not for the clock.
     *
     * A plain timer after `open()` is wrong on the one case that matters: a
     * person typing a card number and waiting for an OTP is well past twenty
     * seconds, and telling them the checkout never opened — "nothing was
     * charged" — while it stands open in front of them would be false, and
     * false about money.
     *
     * So the deadline runs only until there is evidence the modal exists. Once
     * it is on screen the handoff has happened and Razorpay's own events finish
     * the job, however long the person takes.
     */
    const deadline = Date.now() + OPEN_WATCHDOG_MS;

    const poll = () => {
      if (settled) return;

      // It opened. There is nothing left to guard against.
      if (checkoutIsOnScreen()) return;

      if (Date.now() >= deadline) {
        settle({
          outcome: "unavailable",
          reason:
            "Razorpay's checkout did not open. Nothing was charged — try again, and if it keeps happening the order is still on your billing page.",
        });
        return;
      }

      timers.watchdog = setTimeout(poll, OPEN_POLL_MS);
    };

    timers.watchdog = setTimeout(poll, OPEN_POLL_MS);
  });
}
