export function SetupNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">TrackMoney needs setting up</h1>
      <p className="mt-2 text-sm text-muted">
        The app could not read its database. This is expected on a fresh clone.
      </p>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
        <li>
          Copy <code className="font-mono">.env.example</code> to{" "}
          <code className="font-mono">.env.local</code> and fill in your Neon and
          Razorpay <strong>test-mode</strong> keys.
        </li>
        <li>
          Run <code className="font-mono">npm run db:push</code> to create the
          tables.
        </li>
        <li>
          Run <code className="font-mono">npm run db:seed</code> to load the demo
          account.
        </li>
      </ol>
      <p className="mt-4 font-mono text-xs text-bad">{message}</p>
    </div>
  );
}
