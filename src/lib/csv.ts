// CSV generation.
//
// The escaping is the whole job: a client note containing a comma, a quote, a
// newline, or a leading "=" is where naive CSV either corrupts the file or, in
// the "=" case, becomes a formula that runs when the manager opens it in Excel.
// Pure and unit-tested.

/**
 * Quote a single field per RFC 4180, with one addition: fields that begin with
 * a formula trigger (= + - @) are prefixed with a quote-and-apostrophe so a
 * spreadsheet treats them as text. A cell like "=cmd|..." is a real attack
 * vector when the file is opened in Excel.
 */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let s = typeof value === 'string' ? value : String(value)

  // Formula/CSV-injection guard. Prefixing with an apostrophe keeps the visible
  // value intact while forcing text interpretation.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`

  // Quote when the value contains a delimiter, a quote, or a line break;
  // doubling any embedded quotes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** One data row from an ordered list of cells. */
export function toRow(cells: unknown[]): string {
  return cells.map(escapeCell).join(',')
}

export interface CsvColumn<T> {
  header: string
  /** How to pull this column's value out of a record. */
  value: (row: T) => unknown
}

/**
 * Build a CSV string from records and a column spec.
 *
 * A UTF-8 BOM is prepended so Excel reads Arabic client names and the "m²" in
 * property sizes correctly instead of as mojibake — the single most common
 * complaint about CSV exports opened on Windows.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], opts: { bom?: boolean } = {}): string {
  const header = toRow(columns.map(c => c.header))
  const body = rows.map(row => toRow(columns.map(c => c.value(row))))
  const text = [header, ...body].join('\r\n')
  return opts.bom === false ? text : '﻿' + text
}

/** A filesystem-safe, dated filename: "stategen-clients-2026-07-22.csv". */
export function csvFilename(kind: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  const safe = kind.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `stategen-${safe}-${date}.csv`
}
