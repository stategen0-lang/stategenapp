import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { recalculateScores } from '@/lib/score-engine'
import { applyMapping, isValidRow, type ImportKind, type Mapping, type NormProperty, type NormClient } from '@/lib/import/mapping'

// Step 2 of import: take the reviewed headers/rows/mapping and bulk-insert the
// valid rows as properties or clients, scoped to the manager's company.
// Manager-only. Imported clients are left unassigned (agentId null).
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Only a manager can import data.' }, { status: 403 })

  let body: { kind?: ImportKind; headers?: string[]; rows?: string[][]; mapping?: Mapping }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const { kind, headers, rows, mapping } = body
  if ((kind !== 'properties' && kind !== 'clients') || !Array.isArray(headers) || !Array.isArray(rows) || !mapping) {
    return NextResponse.json({ error: 'Missing import data.' }, { status: 400 })
  }

  const normalized = applyMapping(kind, headers, rows, mapping).filter(o => isValidRow(kind, o))
  if (!normalized.length) return NextResponse.json({ error: 'No valid rows to import (each row needs at least a title/price or a client name).' }, { status: 400 })

  const supabase = await createClient()
  const companyId = session.companyId

  let inserts: Record<string, unknown>[]
  if (kind === 'properties') {
    inserts = (normalized as NormProperty[]).map(p => {
      const isRent = p.transaction === 'rent'
      return {
        company_id: companyId,
        Title: p.title || 'Untitled listing',
        Location: p.city || null,
        Neighborhood: p.district || null,
        Price: p.price ?? 0,
        Currency: 'USD',
        Bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        size: p.size,
        Payment_terms: isRent ? 'For Rent' : 'For Sale',
        // Store the app's enum ('For Sale'/'For Rent') and, for rentals, the
        // amount in `rent` (the field the UI reads for /mo pricing).
        Amenities: JSON.stringify({ type: 'Appartement', transaction: isRent ? 'For Rent' : 'For Sale', rent: isRent ? (p.price ?? 0) : 0, agentId: null, imported: true }),
        Status: p.status || 'Available',
      }
    })
  } else {
    // Match the app's enums exactly: ClientType is 'Buyer' | 'Renter' (capitalised),
    // ClientStatus is a fixed set — unknown sheet statuses fall back to 'Searching'.
    const VALID_STATUS = new Set(['Searching', 'Negotiation', 'Signed', 'Viewing'])
    inserts = (normalized as NormClient[]).map(c => {
      const isRenter = c.type === 'renter'
      const status = VALID_STATUS.has((c.status || '').trim()) ? c.status.trim() : 'Searching'
      return {
        company_id: companyId,
        Agent_id: null,
        'Client Name': c.name,
        'client phone': c.phone || null,
        budget_min: 0,
        budget_max: c.budget ?? 0,
        'prefered-location': c.location || null,
        bedrooms: c.bedrooms,
        payment_terms: isRenter ? 'For Rent' : 'For Sale',
        notes: JSON.stringify({
          email: c.email || undefined,
          type: isRenter ? 'Renter' : 'Buyer',
          agentId: null,   // unassigned; the manager can reassign later
          req: { location: c.location || undefined, beds: c.bedrooms ?? undefined, priceMax: c.budget ?? undefined },
          imported: true,
        }),
        status,
      }
    })
  }

  const table = kind === 'properties' ? 'Properties' : 'client_requests'
  // Insert in chunks so a large sheet doesn't hit request/row limits.
  let inserted = 0
  const CHUNK = 200
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK)
    const { data, error } = await supabase.from(table).insert(slice).select('id')
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 })
    inserted += data?.length ?? 0
  }

  // Re-score the company after the response so imported clients get lead scores
  // (used by matching + reminder relevance). Deferred so the import returns fast.
  after(async () => { try { await recalculateScores({ companyId }) } catch { /* non-fatal */ } })

  return NextResponse.json({ inserted, skipped: rows.length - inserted, kind })
}
