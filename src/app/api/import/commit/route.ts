import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { recalculateScores } from '@/lib/score-engine'
import { ensureManagerAgentCode } from '@/lib/ensure-manager-code'
import {
  applyMapping, isValidRow, dedupeKey, normTransaction,
  type ImportKind, type Mapping, type NormProperty, type NormClient,
} from '@/lib/import/mapping'
import type { SupabaseClient } from '@supabase/supabase-js'

// Step 2 of import: take the reviewed headers/rows/mapping and bulk-insert the
// valid rows as properties or clients, scoped to the manager's company.
// Manager-only. Rows already in the file twice, or already in the company's
// data (re-importing the same sheet), are skipped rather than duplicated.
// Imported rows are owned by the importing manager, like anything they add by
// hand; they can hand clients to an agent with Refer.

type Row = Record<string, unknown>

// Everything the company already has, as dedupe keys. Paged because a single
// select stops at 1000 rows.
async function existingKeys(supabase: SupabaseClient, kind: ImportKind, companyId: number): Promise<Set<string>> {
  const keys = new Set<string>()
  const PAGE = 1000
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data } = kind === 'properties'
      ? await supabase.from('Properties').select('Title,Location,Neighborhood,Price,Amenities').eq('company_id', companyId).range(from, from + PAGE - 1)
      : await supabase.from('client_requests').select('"Client Name","client phone"').eq('company_id', companyId).range(from, from + PAGE - 1)
    const page = (data ?? []) as unknown as Row[]
    for (const r of page) {
      if (kind === 'properties') {
        let tx = ''
        try { tx = String(JSON.parse((r.Amenities as string) || '{}').transaction ?? '') } catch { /* no extras */ }
        keys.add(dedupeKey('properties', {
          title: String(r.Title ?? ''), city: String(r.Location ?? ''), district: String(r.Neighborhood ?? ''),
          price: r.Price == null ? null : Number(r.Price), transaction: normTransaction(tx),
        } as NormProperty))
      } else {
        keys.add(dedupeKey('clients', { name: String(r['Client Name'] ?? ''), phone: String(r['client phone'] ?? '') } as NormClient))
      }
    }
    if (page.length < PAGE) break
  }
  return keys
}

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

  const valid = applyMapping(kind, headers, rows, mapping).filter(o => isValidRow(kind, o))
  if (!valid.length) return NextResponse.json({ error: 'No valid rows to import (each row needs at least a title/price or a client name).' }, { status: 400 })

  const supabase = await createClient()
  const companyId = session.companyId

  // Drop repeats inside the file and anything the company already has.
  const seen = await existingKeys(supabase, kind, companyId)
  let duplicates = 0
  const normalized = valid.filter(o => {
    const k = dedupeKey(kind, o)
    if (seen.has(k)) { duplicates++; return false }
    seen.add(k)
    return true
  })
  if (!normalized.length) {
    return NextResponse.json({ inserted: 0, skipped: rows.length, duplicates, kind })
  }

  // The importing manager owns the rows (their agent code is minted if missing).
  let ownerAgent: string | null = session.agentCode ?? null
  if (!ownerAgent) {
    try { ownerAgent = await ensureManagerAgentCode(createAdminClient(), companyId, session.userId, session.fullName) } catch { ownerAgent = null }
  }

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
        Amenities: JSON.stringify({
          type: p.type,
          transaction: isRent ? 'For Rent' : 'For Sale',
          rent: isRent ? (p.price ?? 0) : 0,
          agentId: ownerAgent,
          ownerName: p.ownerName || undefined,
          ownerContact: p.ownerContact || undefined,
          notes: p.notes || undefined,
          // The tick-boxes and the rest of the listing form, so an imported
          // listing is as complete — and as matchable — as a typed one.
          parkings: p.parkings ?? undefined,
          buildingAge: p.buildingAge ?? undefined,
          floor: p.floor || undefined,
          furnishing: p.furnishing || undefined,
          garden: p.garden || undefined,
          balcony: p.balcony || undefined,
          terrace: p.terrace || undefined,
          needsRenovation: p.needsRenovation || undefined,
          amenities: p.amenities.length ? p.amenities : undefined,
          buildingFeatures: p.buildingFeatures.length ? p.buildingFeatures : undefined,
          aiDescription: p.description || undefined,
          publicNotes: p.publicNotes || undefined,
          mapUrl: p.mapUrl || undefined,
          view: p.view || undefined,
          imported: true,
        }),
        Status: p.status || 'Available',
      }
    })
  } else {
    inserts = (normalized as NormClient[]).map(c => {
      const isRenter = c.type === 'renter'
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
          agentId: ownerAgent,
          tags: c.tags.length ? c.tags : undefined,
          req: {
            location: c.location || undefined,
            // The array is what matching scores against; a client open to three
            // areas used to be imported as one string and matched on none.
            locations: c.locations.length ? c.locations : undefined,
            type: c.propertyType || undefined,
            beds: c.bedrooms ?? undefined,
            baths: c.bathrooms ?? undefined,
            size: c.size ?? undefined,
            priceMax: c.budget ?? undefined,
            floor: c.floor || undefined,
            furnishing: c.furnishing || undefined,
            view: c.view || undefined,
            garden: c.garden || undefined,
            balcony: c.balcony || undefined,
            terrace: c.terrace || undefined,
            amenities: c.amenities.length ? c.amenities : undefined,
            buildingFeatures: c.buildingFeatures.length ? c.buildingFeatures : undefined,
            notes: c.notes || undefined,
          },
          imported: true,
        }),
        status: c.status,   // already one of the app's client statuses
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

  return NextResponse.json({ inserted, skipped: rows.length - inserted, duplicates, kind })
}
