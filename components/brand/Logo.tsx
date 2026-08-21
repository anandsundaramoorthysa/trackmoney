/**
 * The TrackMoney mark — PLAN.md §7.3.
 *
 * An ascending track line with a single amber dot on one vertex: the ledger
 * being tracked, and the agent noticing something in it. Four strokes and a
 * circle, so it survives being shrunk to a favicon.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="TrackMoney"
      className={className}
    >
      <rect width="48" height="48" rx="12" fill="var(--tm-primary)" />
      <path
        d="M11 32.5 L20 24 L27 29 L37.5 16"
        stroke="#ffffff"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.95"
      />
      <circle cx="27" cy="29" r="4.25" fill="var(--tm-accent)" />
      <circle cx="27" cy="29" r="4.25" stroke="var(--tm-primary)" strokeWidth="1.5" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`text-[17px] font-semibold tracking-[-0.02em] ${className ?? ""}`}
    >
      <span className="text-ink">Track</span>
      <span className="text-brand">Money</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark size={30} />
      <Wordmark />
    </span>
  );
}
