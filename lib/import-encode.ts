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

export type PreviewRow = ParsedRow & { duplicate: boolean };

export function encodeRow(row: PreviewRow): string {
  return JSON.stringify([
    row.occurredOn,
    row.merchant,
    row.category,
    row.amountPaise,
    row.duplicate ? 1 : 0,
  ]);
}

export function decodeRow(value: string): PreviewRow | null {
  try {
    const [occurredOn, merchant, category, amountPaise, duplicate] =
      JSON.parse(value) as [string, string, string, number, number];

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
    };
  } catch {
    return null;
  }
}
