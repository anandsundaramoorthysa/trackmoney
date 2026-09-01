"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Puts the account back on Free and clears the trail */
export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/demo/reset", { method: "POST" });
          router.refresh();
          // The agent panel holds conversation state in memory, so a full
          // reload is the honest way to show a clean run.
          window.location.reload();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-brand-tint hover:text-ink disabled:opacity-50"
    >
      {busy ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
