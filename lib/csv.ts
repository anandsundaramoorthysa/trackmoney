/**
 * CSV escaping.
 *
 * Two separate concerns, and only one of them is about CSV.
 *
 * The first is quoting: a value containing a comma, a quote, or a line break
 * has to be wrapped and its quotes doubled, or the file no longer parses.
 *
 * The second is that spreadsheets treat a cell beginning with `=`, `+`, `-` or
 * `@` as a formula. A merchant name is user-ish data flowing into a file that
 * Excel or Sheets will open and evaluate, so a leading formula character is
 * prefixed with a tab: the cell still reads correctly to a person, and nothing
 * executes. This costs nothing and is the difference between exporting data and
 * exporting instructions.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `\t${value}` : value;
  return NEEDS_QUOTING.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}
