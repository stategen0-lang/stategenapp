import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { canEditProperty } from '@/lib/permissions'
import { DOC_BUCKET } from '@/lib/upload'

// Serve a listing's private document to authorised callers only.
//
// The private bucket has no public URL. This endpoint re-derives the caller's
// permission (the listing's own agent, or a manager) and, only then, mints a
// short-lived signed URL and redirects to it. Everyone else gets 403/404.

function propertyAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}
function documentPathOf(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').documentPath as string) ?? null } catch { return null }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('Properties').select('id,Amenities').eq('id', id).eq('company_id', session.companyId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same rule as editing: the listing's agent or a manager.
  if (!canEditProperty(session, propertyAgent(row))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const path = documentPathOf(row)
  if (!path) return NextResponse.json({ error: 'No document attached' }, { status: 404 })

  const admin = createAdminClient()
  const { data: signed, error } = await admin.storage.from(DOC_BUCKET).createSignedUrl(path, 60)
  if (error || !signed?.signedUrl) {
    console.error('[properties/document] sign error', error)
    return NextResponse.json({ error: 'Could not open document' }, { status: 500 })
  }
  return NextResponse.redirect(signed.signedUrl)
}
