import { desc, eq } from "drizzle-orm";

import { SetupNotice } from "@/components/SetupNotice";
import { UpgradeButton } from "@/components/UpgradeButton";
import { db } from "@/lib/db";
import { payments, planConfig } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/guard";
import { formatPaise } from "@/lib/money";
import { formatTimestamp } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
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
