import { CATEGORIES } from "@/lib/transactions";

/**
 * Reading a statement
 *
 * Pure functions, no database and no I/O, so the column rules can be tested
 * directly. Everything here is deterministic detection: no model is involved in
 * deciding what a column means, because a wrong guess would put a number in
 * front of the agent that the user never actually spent.
 */

export type ParsedRow = {
  occurredOn: string;
  merchant: string;
  category: string;
  amountPaise: number;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Rows recognised but not usable as an expense — credits, blanks, zeroes. */
  ignored: number;
  headers: string[];
  problem: string | null;
};

/** A small RFC-4180 reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") endRow();
    else if (char !== "\r") field += char;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/**
 * Dates are read as day-first.
 *
 * "03/04/2026" is the third of April here, not the fourth of March. Indian
 * bank and card exports are day-first, and guessing per row would make the
 * same file import differently depending on which dates happened to be
 * ambiguous. One documented assumption beats an inconsistent one.
 */
export function normaliseDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dayFirst = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dayFirst) {
    const [, d, m, rawYear] = dayFirst;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const month = m.padStart(2, "0");
    const day = d.padStart(2, "0");
    if (Number(month) > 12 || Number(day) > 31) return null;
    return `${year}-${month}-${day}`;
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function parseAmountToPaise(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function findColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h.toLowerCase()));
}

/**
 * Find a money column, ignoring anything that is plainly a date.
 *
 * Indian bank statements routinely carry a "Value Date" column, and matching
 * "value" against it picked the date as the amount: every row then failed to
 * parse and the whole file came back as "no spending rows found". A column
 * cannot be both.
 */
function findAmountColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex(
    (h) => pattern.test(h.toLowerCase()) && !/date/.test(h.toLowerCase()),
  );
}

function normaliseCategory(value: string | undefined): string {
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === (value ?? "").trim().toLowerCase(),
  );
  return match ?? "Other";
}

export function parseTransactionsCsv(text: string): ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) {
    return {
      rows: [],
      ignored: 0,
      headers: table[0] ?? [],
      problem: "That file has no rows under its header.",
    };
  }

  const [headers, ...body] = table;
  const dateAt = findColumn(headers, /date|posted|txn date/);
  const merchantAt = findColumn(
    headers,
    /merchant|desc|narration|details|particular|remark|payee|name/,
  );
  const amountAt = findAmountColumn(headers, /amount|amt|value|spent/);
  const debitAt = findAmountColumn(headers, /debit|withdraw|outflow/);
  const creditAt = findAmountColumn(headers, /credit|deposit|inflow/);
  const categoryAt = findColumn(headers, /category|type of expense/);

  if (dateAt < 0 || (amountAt < 0 && debitAt < 0)) {
    return {
      rows: [],
      ignored: 0,
      headers,
      problem:
        "Could not find a date column and an amount column. A header row with 'Date' and 'Amount' (or 'Debit') is enough.",
    };
  }

  const rows: ParsedRow[] = [];
  let ignored = 0;

  for (const cells of body) {
    const occurredOn = normaliseDate(cells[dateAt] ?? "");

    // TrackMoney records spending only, so a credit column is money coming in
    // and is skipped rather than recorded as a negative expense.
    const raw =
      debitAt >= 0 && (cells[debitAt] ?? "").trim()
        ? cells[debitAt]
        : amountAt >= 0
          ? cells[amountAt]
          : "";

    const isCredit =
      debitAt >= 0 &&
      !(cells[debitAt] ?? "").trim() &&
      creditAt >= 0 &&
      Boolean((cells[creditAt] ?? "").trim());

    const paise = parseAmountToPaise(raw ?? "");

    if (!occurredOn || isCredit || paise === null || paise === 0) {
      ignored += 1;
      continue;
    }

    rows.push({
      occurredOn,
      merchant:
        (merchantAt >= 0 ? cells[merchantAt] : "")?.trim().slice(0, 80) ||
        "Unknown merchant",
      category: normaliseCategory(categoryAt >= 0 ? cells[categoryAt] : undefined),
      // A single amount column carries the sign; an expense is its magnitude.
      amountPaise: Math.abs(paise),
    });
  }

  return { rows, ignored, headers, problem: null };
}
