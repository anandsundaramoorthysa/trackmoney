/**
 * Month boundaries in IST.
 *
 * The demo is an Indian product judged in Bangalore, but Vercel runs in UTC.
 * "Transactions this month" must not change meaning depending on where the
 * server happens to be, so every month calculation goes through here.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The current wall-clock date in IST, as {year, month} with month 1-12. */
export function istYearMonth(now: Date = new Date()): {
  year: number;
  month: number;
} {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

/** "2026-08-01" and "2026-09-01" for the current IST month. */
export function istMonthRange(now: Date = new Date()): {
  start: string;
  endExclusive: string;
  label: string;
} {
  const { year, month } = istYearMonth(now);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: isoDate(year, month, 1),
    endExclusive: isoDate(nextYear, nextMonth, 1),
    label: new Intl.DateTimeFormat("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1))),
  };
}

export function isoDate(year: number, month: number, day: number): string {
  return [
    String(year),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/** Shift an ISO date string by whole days. */
export function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

/** Today, in IST — the same clock the month boundaries use. */
export function istToday(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return isoDate(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

/**
 * Is this an ISO date that names a day that exists?
 *
 * The shape check alone let "2026-02-30" and "2025-13-01" through to a `date`
 * column, which threw and reached the user as a 500. Round-tripping is the
 * cheapest way to tell a well-formed string from a real day.
 */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [y, m, d] = value.split("-").map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return (
    asDate.getUTCFullYear() === y &&
    asDate.getUTCMonth() === m - 1 &&
    asDate.getUTCDate() === d
  );
}

/**
 * The window for a named month, rather than for today's month.
 *
 * Everything used to be computed from the clock, which meant the app could only
 * ever show the month it happened to be. Importing a statement from an earlier
 * one wrote the rows correctly and then displayed them nowhere — the ledger,
 * the breakdown and the export were all pinned to "now". A month has to be
 * something the caller can name.
 */
export function monthRangeOf(month: string): {
  start: string;
  endExclusive: string;
  label: string;
} {
  const [year, index] = month.split("-").map(Number);
  const nextYear = index === 12 ? year + 1 : year;
  const nextMonth = index === 12 ? 1 : index + 1;

  return {
    start: isoDate(year, index, 1),
    endExclusive: isoDate(nextYear, nextMonth, 1),
    label: new Intl.DateTimeFormat("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, index - 1, 1))),
  };
}

/** Is this a month the app can show? "2026-13" and "banana" are not. */
export function isRealMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;

  const index = Number(value.slice(5));
  return index >= 1 && index <= 12;
}

/** "2026-09" shifted by whole months, either direction. */
export function shiftMonths(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const zeroBased = year * 12 + (index - 1) + by;

  return `${String(Math.floor(zeroBased / 12)).padStart(4, "0")}-${String(
    (zeroBased % 12) + 1,
  ).padStart(2, "0")}`;
}

/**
 * Which month a request is asking for.
 *
 * Anything unreadable falls back to the current one rather than erroring: a
 * hand-edited address should show the app, not a stack trace. Months ahead of
 * the current one are refused for the same reason the date field refuses them —
 * there is nothing there yet, and offering to page into an empty future is a
 * promise the data cannot keep.
 */
export function resolveMonth(requested: string | undefined, now = new Date()): string {
  const current = istMonthRange(now).start.slice(0, 7);
  if (!requested || !isRealMonth(requested)) return current;

  return requested > current ? current : requested;
}
