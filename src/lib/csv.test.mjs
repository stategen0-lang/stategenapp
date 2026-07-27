// Unit tests for CSV generation (src/lib/csv.ts) and the export columns.
// The escaping is the part that corrupts a file or lets a formula run, so it is
// tested hardest.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeCell, toRow, toCsv, csvFilename } from './csv.ts'
import { CLIENT_COLUMNS, PROPERTY_COLUMNS, isExportKind } from './export-columns.ts'

// ── escapeCell ──────────────────────────────────────────────────────────────
test('escapeCell: plain values pass through', () => {
  assert.equal(escapeCell('Ahmed'), 'Ahmed')
  assert.equal(escapeCell(42), '42')
  assert.equal(escapeCell('Beirut'), 'Beirut')
})
test('escapeCell: null and undefined become empty', () => {
  assert.equal(escapeCell(null), '')
  assert.equal(escapeCell(undefined), '')
})
test('escapeCell: a comma forces quoting', () => {
  assert.equal(escapeCell('Hamra, Beirut'), '"Hamra, Beirut"')
})
test('escapeCell: embedded quotes are doubled', () => {
  assert.equal(escapeCell('the "big" villa'), '"the ""big"" villa"')
})
test('escapeCell: newlines force quoting so a note cannot split a row', () => {
  assert.equal(escapeCell('line one\nline two'), '"line one\nline two"')
  assert.equal(escapeCell('carriage\r\nreturn'), '"carriage\r\nreturn"')
})
test('escapeCell: a leading = is neutralised (formula injection)', () => {
  // "=1+1" in a cell executes when opened in Excel. The apostrophe forces text.
  assert.equal(escapeCell('=1+1'), "'=1+1")
  assert.equal(escapeCell('=cmd|"/c calc"!A1'), '"\'=cmd|""/c calc""!A1"')
})
test('escapeCell: the other formula triggers are neutralised too', () => {
  assert.equal(escapeCell('+1'), "'+1")
  assert.equal(escapeCell('-1'), "'-1")
  assert.equal(escapeCell('@SUM(A1)'), "'@SUM(A1)")
})
test('escapeCell: a normal negative number written as text is guarded', () => {
  // Better a leading apostrophe than a live formula — the value is still legible.
  assert.equal(escapeCell('-5'), "'-5")
  // A real number stays a number (no leading char to trigger the guard).
  assert.equal(escapeCell(-5), "'-5")   // String(-5) starts with '-', so guarded
})

// ── rows and documents ──────────────────────────────────────────────────────
test('toRow: joins cells with commas, escaping each', () => {
  assert.equal(toRow(['a', 'b,c', 'd']), 'a,"b,c",d')
})
test('toCsv: header then rows, CRLF separated', () => {
  const cols = [
    { header: 'Name', value: r => r.name },
    { header: 'City', value: r => r.city },
  ]
  const csv = toCsv([{ name: 'Ahmed', city: 'Beirut' }], cols, { bom: false })
  assert.equal(csv, 'Name,City\r\nAhmed,Beirut')
})
test('toCsv: prepends a UTF-8 BOM by default so Excel reads Arabic and m²', () => {
  const csv = toCsv([{ n: 'سارة' }], [{ header: 'n', value: r => r.n }])
  assert.equal(csv.charCodeAt(0), 0xfeff)
})
test('toCsv: an empty dataset still yields a header row', () => {
  const csv = toCsv([], [{ header: 'Name', value: r => r.name }], { bom: false })
  assert.equal(csv, 'Name')
})

// ── filename ────────────────────────────────────────────────────────────────
test('csvFilename: dated and filesystem-safe', () => {
  const name = csvFilename('Pipeline deals', new Date('2026-07-22T09:00:00Z'))
  assert.equal(name, 'stategen-pipeline-deals-2026-07-22.csv')
})

// ── column specs against real shapes ────────────────────────────────────────
test('CLIENT_COLUMNS: pulls the fields a manager expects', () => {
  const client = {
    id: 7, name: 'Ahmed Khoury', type: 'Buyer', phone: '03111222', email: 'a@x.com',
    status: 'Searching', budget: 400000, agentId: 'a2', leadScore: 62, agentRating: 4,
    req: { location: 'Hamra', type: 'Appartement', beds: 3, transaction: 'For Sale' },
  }
  const row = CLIENT_COLUMNS.map(c => c.value(client))
  assert.equal(row[CLIENT_COLUMNS.findIndex(c => c.header === 'Name')], 'Ahmed Khoury')
  assert.equal(row[CLIENT_COLUMNS.findIndex(c => c.header === 'Phone')], '03111222')
  assert.equal(row[CLIENT_COLUMNS.findIndex(c => c.header === 'Budget (USD)')], 400000)
  assert.equal(row[CLIENT_COLUMNS.findIndex(c => c.header === 'Wants')], 'Hamra')
})
test('PROPERTY_COLUMNS: booleans render as Yes/No', () => {
  const prop = {
    id: 1, title: 'Flat', type: 'Appartement', transaction: 'For Sale', price: 450000,
    rent: 0, city: 'Beirut', district: 'Hamra', size: 140, beds: 3, baths: 2,
    garden: false, balcony: true, view: 'Sea', status: 'Available', agentId: 'a1',
  }
  const get = h => PROPERTY_COLUMNS.find(c => c.header === h).value(prop)
  assert.equal(get('Garden'), 'No')
  assert.equal(get('Balcony'), 'Yes')
  assert.equal(get('Rent /mo (USD)'), '')   // 0 rent shows blank, not "0"
  assert.equal(get('Price (USD)'), 450000)
})

// ── whole-document round trip ───────────────────────────────────────────────
test('toCsv: a nasty client note cannot break the row structure', () => {
  const client = {
    id: 1, name: 'Injected', type: 'Buyer', phone: '=HYPERLINK("evil")',
    email: 'x@y.com', status: 'Searching', budget: 0, agentId: 'a1',
    leadScore: 0, agentRating: 3,
    req: { location: 'has, comma\nand newline', type: '', beds: 0, transaction: '' },
  }
  const csv = toCsv([client], CLIENT_COLUMNS, { bom: false })
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 2)                    // header + exactly one row
  assert.match(csv, /'=HYPERLINK/)                 // formula neutralised
  assert.match(csv, /"has, comma\nand newline"/)   // comma+newline quoted, not split
})

// ── kind validation ─────────────────────────────────────────────────────────
test('isExportKind: accepts the known kinds only', () => {
  assert.equal(isExportKind('clients'), true)
  assert.equal(isExportKind('properties'), true)
  assert.equal(isExportKind('deals'), true)
  assert.equal(isExportKind('events'), true)
  assert.equal(isExportKind('secrets'), false)
  assert.equal(isExportKind(''), false)
  assert.equal(isExportKind(null), false)
})
