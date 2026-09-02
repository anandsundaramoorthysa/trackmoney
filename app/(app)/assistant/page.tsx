import { AgentPanel } from "@/components/AgentPanel";
import { SetupNotice } from "@/components/SetupNotice";
import { requireUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * The assistant, on its own page.
 *
 * It used to share the dashboard with the ledger, which made the conversation
 * a narrow column beside the thing it was talking about. A demo lives or dies
 * on that conversation being readable, so it gets the page — capped at a
 * reading width, because a chat stretched across a wide monitor is harder to
 * follow, not easier.
 */
export default async function AssistantPage() {
  try {
    const user = await requireUser();

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Assistant
          </h1>
          <p className="mt-1 text-sm text-muted">
            It reads the same month you see on the dashboard and can prepare an
            upgrade, but it cannot open a checkout or take a payment — you do
            both. Everything it does is logged on the Agent activity page.
          </p>
        </div>

        <AgentPanel
          profile={{ name: user.name, email: user.email }}
          plan={user.plan}
        />
      </div>
    );
  } catch (error) {
    return <SetupNotice error={error} />;
  }
}
