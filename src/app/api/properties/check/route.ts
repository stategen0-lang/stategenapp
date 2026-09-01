import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { dbRowToProperty } from '@/lib/db-mappers'
import { findPropertyDupes } from '@/lib/dedupe'

// Duplicate-check for a listing about to be created/edited. Listings aren't
// PII-masked (every company member can already see them for matching), so a
// match can be returned with its title.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const cand = {
    title: String(body.title ?? ''),
    district: String(body.district ?? ''),
    city: String(body.city ?? ''),
    type: String(body.type ?? ''),
    transaction: String(body.transaction ?? ''),
    price: Number(body.price) || 0,
    rent: Number(body.rent) || 0,
  }
  const selfId = body.id != null ? Number(body.id) : undefined
  if (!cand.title.trim() && !cand.city.trim()) return NextResponse.json({ dupes: [] })

  const supabase = await createClient()
  const { data } = await supabase.from('Properties').select('*').eq('company_id', session.companyId)
  const existing = (data ?? []).map((r, i) => dbRowToProperty(r as Record<string, unknown>, i))

  const dupes = findPropertyDupes(cand, existing, selfId).map(p => ({ id: p.id, title: p.title }))
  return NextResponse.json({ dupes })
}
