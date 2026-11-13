/**
 * CSV helpers.
 *
 * `escapeCsvCell` both quotes a field correctly and neutralizes spreadsheet
 * formula injection: a value beginning with =, +, -, @, TAB, or CR is prefixed
 * with a single quote so spreadsheet applications treat it as text.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Serializes a header row plus data rows into an RFC-4180-style CSV string. */
export function toCsv(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}
