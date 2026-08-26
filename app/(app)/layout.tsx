import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth/guard";

/**
 * The signed-in shell.
 *
 * The guard lives here rather than in middleware so it is authoritative:
 * middleware runs before the database is consulted and can only see that a
 * cookie exists, not that it still means anything.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="border-b border-line bg-agent-tint px-5 py-2 text-xs text-muted">
          Demo for the Razorpay AI Buildathon. Razorpay runs in test mode and no
          real money moves — please do not enter real financial data.
        </p>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
