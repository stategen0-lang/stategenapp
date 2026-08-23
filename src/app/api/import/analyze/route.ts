import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { parseCsv } from '@/lib/import/parse'
import { inferMapping } from '@/lib/ai/import-map'
import type { ImportKind } from '@/lib/import/mapping'

// Step 1 of import: parse the uploaded sheet and let the AI propose a column
// mapping. Returns headers + rows + mapping for the client to review. Nothing is
// saved here. Manager-only — bulk-importing company data is an owner action.
const MAX_ROWS = 5000

function cellToStr(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string }
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join('')
    if (o.text != null) return String(o.text)
    if (o.result != null) return String(o.result)
    return ''
  }
  return String(v)
}

async function parseXlsx(buf: ArrayBuffer): Promise<{ headers: string[]; rows: string[][] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  if (!ws) return { headers: [], rows: [] }
  const matrix: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[]   // exceljs is 1-indexed; vals[0] is empty
    const arr: string[] = []
    for (let i = 1; i < vals.length; i++) arr.push(cellToStr(vals[i]))
    if (arr.some(c => c.trim() !== '')) matrix.push(arr)
  })
  const headers = (matrix.shift() ?? []).map(h => h.trim())
  return { headers, rows: matrix }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Only a manager can import data.' }, { status: 403 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 }) }

  const file = form.get('file')
  const kind = form.get('kind') as ImportKind
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  if (kind !== 'properties' && kind !== 'clients') return NextResponse.json({ error: 'Invalid import type.' }, { status: 400 })

  const name = file.name.toLowerCase()
  let parsed: { headers: string[]; rows: string[][] }
  try {
    if (name.endsWith('.xlsx')) parsed = await parseXlsx(await file.arrayBuffer())
    else parsed = parseCsv(await file.text())   // .csv (and .txt)
  } catch {
    return NextResponse.json({ error: 'Could not read that file. Please upload a .xlsx or .csv.' }, { status: 400 })
  }

  if (!parsed.headers.length) return NextResponse.json({ error: 'No columns found — is the first row a header row?' }, { status: 400 })
  if (!parsed.rows.length) return NextResponse.json({ error: 'No data rows found under the header.' }, { status: 400 })

  const rows = parsed.rows.slice(0, MAX_ROWS)
  const mapping = await inferMapping(kind, parsed.headers, rows.slice(0, 4))

  return NextResponse.json({
    kind,
    headers: parsed.headers,
    rows,
    mapping,
    total: parsed.rows.length,
    truncated: parsed.rows.length > MAX_ROWS,
  })
}
