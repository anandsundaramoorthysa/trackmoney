import { desc, eq } from "drizzle-orm";

import { SetupNotice } from "@/components/SetupNotice";
import { UpgradeButton } from "@/components/UpgradeButton";
import { db } from "@/lib/db";
import { payments, planConfig } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { formatPaise } from "@/lib/money";
import { issueMandateAction } from "@/lib/mandate-actions";
import { MANDATE_TTL_MINUTES } from "@/lib/mandates";
import { MANDATE_COOKIE, readOnce } from "@/lib/one-time-cookie";
import { formatTimestamp } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    issued?: string;
    expires?: string;
    mandateError?: string;
  }>;
}) {
  const { issued, expires, mandateError } = await searchParams;
  // A mandate is a bearer credential, so it is handed over by a short httpOnly
  // cookie rather than written into the URL and the access log. `issued` is the
  // nonce that unlocks it, so revisiting this page later shows nothing.
  const mandate = await readOnce(MANDATE_COOKIE, issued);

  try {
    const user = await requireUser();
    const plans = await db.select().from(planConfig);
    const free = plans.find((p) => p.plan === "free")!;
    const pro = plans.find((p) => p.plan === "pro")!;

    const history = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, user.id))
      .orderBy(desc(payments.createdAt));

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            The ordinary way to upgrade, with no agent involved. This button and
            the assistant call the same server function —{" "}
            <code className="font-mono text-xs">createProUpgradeOrder()</code> —
            so the agent has no payment path of its own.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard
            title={free.label}
            price="Free"
            features={free.features}
            current={user.plan === "free"}
          />
          <PlanCard
            title={pro.label}
            price={`${formatPaise(pro.pricePaise)} one-time`}
            features={pro.features}
            current={user.plan === "pro"}
            highlight
            action={
              <UpgradeButton
                profile={{ name: user.name, email: user.email }}
                plan={user.plan}
              />
            }
          />
        </div>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Let an AI agent buy this</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            A purchase mandate is a one-time authorisation an AI buyer presents
            instead of you clicking. It names one product, caps the amount at{" "}
            {formatPaise(pro.pricePaise)}, expires in {MANDATE_TTL_MINUTES}{" "}
            minutes, and is spent by the first order that uses it. It authorises
            an <em>order</em>, never a payment: you still authorise that in
            Razorpay&apos;s own checkout.
          </p>

          {mandateError && (
            <p className="mt-3 rounded-lg border border-bad/30 bg-agent-tint px-3 py-2 text-sm text-bad">
              {mandateError}
            </p>
          )}

          {mandate ? (
            <div className="mt-4 rounded-lg border border-agent/40 bg-agent-tint p-3">
              <p className="text-xs text-muted">
                Shown once. Expires{" "}
                {expires ? formatTimestamp(new Date(expires)) : "shortly"}.
              </p>
              <p className="mt-1 break-all font-mono text-xs">{mandate}</p>
            </div>
          ) : (
            user.plan === "free" && (
              <form action={issueMandateAction} className="mt-4 flex flex-wrap gap-2">
                <input
                  name="purpose"
                  placeholder="What is this agent buying for you?"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition-colors hover:bg-brand-tint"
                >
                  Issue a mandate
                </button>
              </form>
            )
          )}

          <p className="mt-3 text-xs text-muted">
            The machine-readable catalogue lives at{" "}
            <a href="/api/catalog" className="text-brand hover:underline">
              /api/catalog
            </a>
            .
          </p>
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
            Payment history
          </h2>
          {history.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No orders yet. Everything below runs in Razorpay test mode.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Order</th>
                    <th className="px-4 py-2 font-medium">Started by</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-line/60 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted tabular">
                        {formatTimestamp(row.createdAt)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {row.razorpayOrderId}
                      </td>
                      <td className="px-4 py-2">
                        {row.initiatedBy === "agent" ? (
                          <span className="text-agent">agent</span>
                        ) : row.initiatedBy === "ai_buyer" ? (
                          <span className="text-agent">AI buyer</span>
                        ) : (
                          <span className="text-muted">billing page</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={row.status} />
                        {row.failureReason && (
                          <span className="ml-2 text-xs text-muted">
                            {row.failureReason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular">
                        {formatPaise(row.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-muted">
          Test-mode cards: <code className="font-mono">4111 1111 1111 1111</code>{" "}
          succeeds, <code className="font-mono">4000 0000 0000 0002</code> fails.
          Any future expiry and any CVV.
        </p>
      </div>
    );
  } catch (error) {
    return <SetupNotice error={error} />;
  }
}

function PlanCard({
  title,
  price,
  features,
  current,
  highlight,
  action,
}: {
  title: string;
  price: string;
  features: string[];
  current: boolean;
  highlight?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-5 ${
        highlight ? "border-brand" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {current && (
          <span className="rounded-full bg-brand-tint px-2.5 py-0.5 text-xs text-brand">
            Current plan
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-xl tabular">{price}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        {features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: "created" | "success" | "failed" }) {
  const styles = {
    created: "bg-brand-tint text-brand",
    success: "bg-brand-tint text-ok",
    failed: "bg-agent-tint text-bad",
  }[status];

  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-xs ${styles}`}>
      {status}
    </span>
  );
}
