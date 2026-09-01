/**
 * A buyer agent
 *
 * A separate party, not this project's assistant wearing another hat. It knows
 * nothing about TrackMoney beyond the URL: it reads the catalogue, works out
 * what it costs, presents the mandate its principal gave it, and stops at the
 * point where a human has to authorise the money.
 *
 * The second half is the interesting half. It then tries every way of getting
 * more than it was granted — replaying a spent mandate, buying a different
 * product, buying with no mandate at all — and prints each refusal. A bound
 * nobody watches being enforced is indistinguishable from one that is not there.
 *
 *   npm run buyer-agent -- --mandate tmm_xxx [--base http://localhost:3000]
 */

type Catalog = {
  protocol: string;
  currency: string;
  minorUnit: string;
  products: {
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    features: string[];
  }[];
  purchase: { endpoint: string; method: string; gates: string[] };
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const BASE = (argument("base") ?? "http://localhost:3000").replace(/\/$/, "");
const MANDATE = argument("mandate");

function heading(text: string) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

async function buy(
  body: Record<string, unknown>,
  token: string | undefined,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${BASE}/api/agent-commerce/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    payload: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function main() {
  if (!MANDATE) {
    console.error(
      "Give me a mandate: npm run buyer-agent -- --mandate <token>\n" +
        "Issue one from the Billing page while signed in.",
    );
    process.exit(1);
  }

  heading("1. Discover what this merchant sells");
  const catalog = (await fetch(`${BASE}/api/catalog`).then((r) =>
    r.json(),
  )) as Catalog;

  console.log(`protocol   ${catalog.protocol}`);
  for (const product of catalog.products) {
    console.log(
      `product    ${product.id} — ${product.name}, ${rupees(product.priceMinor)} (${product.priceMinor} ${catalog.minorUnit})`,
    );
  }
  console.log("gates      " + catalog.purchase.gates.join("\n           "));

  const target = catalog.products[0];
  if (!target) {
    console.error("Nothing is for sale here.");
    process.exit(1);
  }

  heading("2. Buy it, presenting the mandate my principal signed");
  const bought = await buy(
    { productId: target.id, maxAmountMinor: target.priceMinor },
    MANDATE,
  );

  if (bought.status !== 200) {
    console.log(`refused    ${bought.status} ${JSON.stringify(bought.payload)}`);
    console.log(
      "\nNothing further to try without a live mandate. Issue a fresh one and run again.",
    );
    return;
  }

  console.log(`order      ${bought.payload.orderId}`);
  console.log(`amount     ${rupees(Number(bought.payload.amountMinor))}`);
  console.log(
    `settlement ${(bought.payload.settlement as { status?: string })?.status}`,
  );
  console.log(
    "\nI have committed my principal to an order. I cannot pay it — a person\n" +
      "authorises that in Razorpay's checkout. That is the boundary.",
  );

  heading("3. Now try to exceed what I was granted");

  const attempts: { label: string; run: () => Promise<{ status: number; payload: Record<string, unknown> }> }[] = [
    {
      label: "replay the same mandate for a second order",
      run: () => buy({ productId: target.id, maxAmountMinor: target.priceMinor }, MANDATE),
    },
    {
      label: "buy a different product with this mandate",
      run: () => buy({ productId: "free", maxAmountMinor: target.priceMinor }, MANDATE),
    },
    {
      label: "buy with no mandate at all",
      run: () => buy({ productId: target.id, maxAmountMinor: target.priceMinor }, undefined),
    },
    {
      label: "buy with a mandate I invented",
      run: () =>
        buy(
          { productId: target.id, maxAmountMinor: target.priceMinor },
          "tmm_not_a_real_mandate",
        ),
    },
  ];

  for (const attempt of attempts) {
    const result = await attempt.run();
    const reason =
      (result.payload.refusedBecause as string) ??
      (result.payload.error as string) ??
      "allowed";
    const verdict = result.status === 200 ? "ALLOWED" : "refused";
    console.log(`${verdict.padEnd(8)} ${attempt.label} → ${result.status} ${reason}`);
  }

  console.log(
    "\nEvery attempt above is also on the merchant's audit trail at /agent-activity,\n" +
      "recorded as an AI buyer acting on a mandate rather than as the account holder.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
