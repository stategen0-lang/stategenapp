import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { loadAreas } from '@/lib/lebanon/areas'
import { checkPin, alreadyKnown, areaFromPin, type LearnedAreaRow } from '@/lib/lebanon/learned-areas'

// Places this agency has taught the app — see migration 030.
//
// GET  the agency's learned areas, for the area field and for matching.
// POST a pin: { name, lat, lng }. The caza and governorate are worked out here
//      from the nearest known place, so the agent answers one question.

type Row = Record<string, unknown>

const toRow = (r: Row): LearnedAreaRow => ({
  id: Number(r.id),
  name: String(r.name ?? ''),
  lat: Number(r.lat),
  lng: Number(r.lng),
  caza: (r.caza as string | null) ?? '',
  governorate: (r.governorate as string | null) ?? '',
})

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('company_areas')
    .select('id, name, lat, lng, caza, governorate')
    .eq('company_id', session.companyId)
    .order('name')

  // Before migration 030 there is no table. An agency simply has nothing
  // learned yet, which is not an error worth breaking the listing form over.
  if (error) return NextResponse.json({ areas: [] })

  return NextResponse.json({ areas: (data ?? []).map(r => toRow(r as Row)) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const pin = checkPin(body?.name, body?.lat, body?.lng)
  if (!pin.ok) return NextResponse.json({ error: pin.error }, { status: 400 })

  // Teaching the app a place it already knows would undo the thing the
  // gazetteer is for: "Achrafiye" must keep correcting to Achrafieh, not become
  // an area of its own sitting beside it.
  const ix = await loadAreas()
  const known = alreadyKnown(ix, pin.name)
  if (known) {
    return NextResponse.json({
      error: `We already know this one as ${known.name} (${known.caza}). Type that and it will be found.`,
      known: known.name,
    }, { status: 409 })
  }

  const area = areaFromPin(ix, pin.name, pin.lat, pin.lng)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('company_areas')
    .insert({
      company_id: session.companyId,
      name: area.name,
      lat: area.lat,
      lng: area.lng,
      caza: area.caza,
      governorate: area.governorate,
      created_by: session.agentCode ?? null,
    })
    .select('id, name, lat, lng, caza, governorate')
    .single()

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'Your agency already has an area with that name.' }, { status: 409 })
    }
    if (/company_areas/.test(error.message)) {
      return NextResponse.json({ error: 'Run database migration 030 first.' }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ area: toRow(data as Row) })
}
