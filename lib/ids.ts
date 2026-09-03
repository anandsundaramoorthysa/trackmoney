/**
 * Does this look like an id this app issues?
 *
 * Row ids are Postgres uuids. A value that is not one cannot match any row, but
 * handing it to the driver is not harmless: Postgres raises 22P02 on the cast
 * and the request comes back a 500 — an "Application error" page for what is
 * really just a bad id. A mistyped link, a stale bookmark or a forged form all
 * produced one.
 *
 * Asking this first turns those into the answer they always should have had:
 * the same "no such row" a well-formed id belonging to somebody else already
 * gets. Same wording either way, so this never becomes a way to find out which
 * ids exist.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
