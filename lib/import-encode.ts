import type { ParsedRow } from "@/lib/csv-import";

/**
 * The preview's wire format.
 *
 * Parsed rows travel from the upload step to the commit step inside the form
 * itself, so nothing is held server-side between the two and the flow survives
 * a reload. Kept apart from the server actions because a "use server" module
 * may only export async functions.
 */

export const MAX_IMPORT_ROWS = 300;

export type PreviewRow = ParsedRow & {
  duplicate: boolean;
  /**
   * The rule's pattern, when a rule chose this row's category.
   *
   * Carried so the preview can say why a row was filed where it was. A category
   * that appears with no explanation is one nobody trusts, and the whole point
   * of previewing is to disagree before anything is written.
   */
  matchedPattern?: string | null;
};

export function encodeRow(row: PreviewRow): string {
  return JSON.stringify([
    row.occurredOn,
    row.merchant,
    row.category,
    row.amountPaise,
    row.duplicate ? 1 : 0,
    row.matchedPattern ?? null,
  ]);
}

export function decodeRow(value: string): PreviewRow | null {
  try {
    // The pattern was added after the first version of this format, so a row
    // encoded before it simply has nothing at that position.
    const [occurredOn, merchant, category, amountPaise, duplicate, matchedPattern] =
      JSON.parse(value) as [
        string,
        string,
        string,
        number,
        number,
        string | null | undefined,
      ];

    if (
      typeof occurredOn !== "string" ||
      typeof merchant !== "string" ||
      typeof category !== "string" ||
      typeof amountPaise !== "number" ||
      !Number.isInteger(amountPaise)
    ) {
      return null;
    }

    return {
      occurredOn,
      merchant,
      category,
      amountPaise,
      duplicate: duplicate === 1,
      matchedPattern: typeof matchedPattern === "string" ? matchedPattern : null,
    };
  } catch {
    return null;
  }
}
