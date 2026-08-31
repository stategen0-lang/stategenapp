import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManager } from '@/lib/permissions'
import { isStoredPhoto } from '@/lib/upload'

// The agency's public branding for shared listing pages (/l/<token>): a logo and
// an accent colour. GET is open to any signed-in member (so the settings screen
// can show the current values); PATCH is managers only.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // select('*') so a missing migration 016 degrades to name-only rather than erroring.
  const { data } = await admin.from('Companies').select('*').eq('id', session.companyId).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({
    name: (row.Name as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    brandColor: (row.brand_color as string) ?? null,
    domain: (row.domain as string) ?? null,   // slug for the public microsite (/a/<domain>)
  })
}

const HEX = /^#[0-9a-fA-F]{6}$/

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { logoUrl?: unknown; brandColor?: unknown }
  const update: Record<string, unknown> = {}

  // Logo: only a URL from our own Storage bucket (produced by /api/upload), or
  // empty string / null to clear it. Never an arbitrary external URL.
  if ('logoUrl' in body) {
    const v = body.logoUrl
    if (v === null || v === '') update.logo_url = null
    else if (typeof v === 'string' && isStoredPhoto(v)) update.logo_url = v
    else return NextResponse.json({ error: 'Logo must be an uploaded image.' }, { status: 400 })
  }

  // Accent colour: a #RRGGBB hex, or empty/null to clear (it's dropped straight
  // into a style attribute, so anything else is rejected).
  if ('brandColor' in body) {
    const v = body.brandColor
    if (v === null || v === '') update.brand_color = null
    else if (typeof v === 'string' && HEX.test(v)) update.brand_color = v
    else return NextResponse.json({ error: 'Colour must be a hex value like #1A2B4A.' }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('Companies').update(update).eq('id', session.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
