/**
 * Postgres tells us when a rule it is keeping has been broken. 23505 is a
 * unique violation, which in this codebase is usually an expected outcome —
 * a duplicate import row, or losing a race — rather than a fault.
 */
export function isUniqueViolation(error: unknown): boolean {
  const direct = (error as { code?: string })?.code;
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  return direct === "23505" || cause === "23505";
}
