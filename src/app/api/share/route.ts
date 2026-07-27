import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { makeShareToken, shareSecret } from '@/lib/share'

// Mint a public share link for a listing.
//
// Auth-gated: only a signed-in user can generate a link, and only for a
// property in their own company. The link itself is public — that is the point
// — but the ability to create one is not.

function origin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'A valid listing id is required.' }, { status: 400 })
  }

  // Confirm the listing exists in this company before handing out a link.
  const supabase = await createClient()
  const { data } = await supabase
    .from('Properties')
    .select('id')
    .eq('company_id', session.companyId)
    .eq('id', id)
    .maybeSingle()

  if (!data) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 })

  const token = makeShareToken(id, shareSecret())
  return NextResponse.json({ token, url: `${origin(req)}/l/${token}` })
}
