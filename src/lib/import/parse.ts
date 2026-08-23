// Minimal, correct CSV parser → { headers, rows }. Handles quoted fields,
// embedded commas/newlines, escaped quotes (""), CRLF, and a leading BOM.
// (.xlsx is parsed separately with exceljs in the API route.)

export interface ParsedSheet {
  headers: string[]
  rows: string[][] // each row aligned to headers by position
}

export function parseCsv(text: string): ParsedSheet {
  const s = String(text ?? '').replace(/^﻿/, '') // strip BOM
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }  // escaped quote
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      record.push(field); field = ''
    } else if (c === '\n') {
      record.push(field); records.push(record); record = []; field = ''
    } else if (c === '\r') {
      // ignore; the \n handles the row break
    } else {
      field += c
    }
  }
  // trailing field/record when the file doesn't end in a newline
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record) }

  // drop fully-blank rows (common at the end of exported sheets)
  const nonBlank = records.filter(r => r.some(c => c.trim() !== ''))
  const headers = (nonBlank.shift() ?? []).map(h => h.trim())
  return { headers, rows: nonBlank }
}
