import Link from "next/link";

import { monthRangeOf, shiftMonths } from "@/lib/time";

/**
 * Paging between months.
 *
 * The app used to show whichever month it happened to be, and nothing else.
 * That is fine until a statement from an earlier month is imported: the rows
 * land correctly and then appear nowhere, which reads as the import having
 * failed rather than as the page being pinned to now.
 *
 * Rendered as links rather than buttons because the month is a property of the
 * address, not of some client state — it survives a reload, it can be shared,
 * and the whole thing keeps working with JavaScript switched off.
 */
export function MonthNav({
  month,
  currentMonth,
  earliestMonth,
  basePath,
}: {
  /** The month being shown, "2026-09". */
  month: string;
  /** The month it is now; there is nothing after this to page into. */
  currentMonth: string;
  /** The oldest month with anything in it, or null when the account is empty. */
  earliestMonth: string | null;
  basePath: string;
}) {
  const previous = shiftMonths(month, -1);
  const next = shiftMonths(month, 1);

  // Stop at the oldest month that holds something. Paging endlessly back
  // through empty months is motion without information.
  const canGoBack = earliestMonth !== null && previous >= earliestMonth;
  const canGoForward = next <= currentMonth;

  return (
    <div className="flex items-center gap-1">
      <Step
        href={`${basePath}?month=${previous}`}
        enabled={canGoBack}
        label="Previous month"
        glyph="‹"
      />

      <span className="min-w-[9.5rem] text-center text-sm font-medium tabular">
        {monthRangeOf(month).label}
      </span>

      <Step
        href={`${basePath}?month=${next}`}
        enabled={canGoForward}
        label="Next month"
        glyph="›"
      />

      {month !== currentMonth && (
        <Link
          href={basePath}
          className="ml-2 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-brand-tint hover:text-ink"
        >
          This month
        </Link>
      )}
    </div>
  );
}

function Step({
  href,
  enabled,
  label,
  glyph,
}: {
  href: string;
  enabled: boolean;
  label: string;
  glyph: string;
}) {
  const shape =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-line text-base leading-none";

  // A dead end is shown rather than hidden, so the control does not change
  // shape as you move through it.
  if (!enabled) {
    return (
      <span
        aria-hidden
        className={`${shape} cursor-not-allowed text-muted opacity-40`}
      >
        {glyph}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={`${shape} text-muted transition-colors hover:bg-brand-tint hover:text-ink`}
    >
      {glyph}
    </Link>
  );
}

/**
 * What to say when the chosen month is empty but the account is not.
 *
 * A blank page in that situation reads as data loss, so it names the nearest
 * month that actually holds something and offers to go there.
 */
export function EmptyMonthNotice({
  month,
  nearest,
  basePath,
}: {
  month: string;
  nearest: string | null;
  basePath: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-6 text-center">
      <p className="text-sm text-muted">
        Nothing recorded in {monthRangeOf(month).label}.
      </p>

      {nearest && (
        <p className="mt-2 text-sm">
          <Link
            href={`${basePath}?month=${nearest}`}
            className="text-brand hover:underline"
          >
            Your most recent activity is in {monthRangeOf(nearest).label}
          </Link>
        </p>
      )}
    </div>
  );
}
