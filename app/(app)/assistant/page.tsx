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
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ explain?: string }>;
}) {
  try {
    const user = await requireUser();
    const { explain } = await searchParams;

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:gap-5">
        {/*
          The heading gets out of the way when there is no height to spare.

          A landscape phone is 375px tall, and so is a portrait one with the
          keyboard open — which is the state somebody is in precisely when they
          are typing to the assistant. On those, a title and a paragraph
          explaining the page cost more than they are worth: what is needed is
          the conversation and the box to type in. The heading stays for screen
          readers either way, since it is what names the page.
        */}
        <div className="[@media(max-height:520px)]:sr-only">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Assistant
          </h1>
          {/*
            Four lines of this on a phone is four lines the conversation does
            not get. The limit that matters is kept at every width; the rest is
            for a screen with room to spare.
          */}
          <p className="mt-1 text-sm text-muted">
            It cannot open a checkout or take a payment — you do both.
            <span className="hidden sm:inline">
              {" "}
              Ask about the month you see on the dashboard, or say what you
              spent and it will draft it for you to confirm. Everything it does
              is logged on the Agent activity page.
            </span>
          </p>
        </div>

        <AgentPanel
          profile={{ name: user.name, email: user.email }}
          plan={user.plan}
          explainId={explain}
        />
      </div>
    );
  } catch (error) {
    return <SetupNotice error={error} />;
  }
}
