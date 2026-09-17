import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { canEditClient } from '@/lib/permissions'
import { DOC_BUCKET } from '@/lib/upload'

// Serve one of a client's private closing documents to authorised callers
// only. Same pattern as /api/properties/document: the private bucket has no
// public URL, so we re-derive the caller's permission (the client's own
// agent, or a manager) and only then mint a short-lived signed URL.

function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  const path = req.nextUrl.searchParams.get('path')
  if (!id || !path) return NextResponse.json({ error: 'id and path required' }, { status: 400 })

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('client_requests').select('id,notes').eq('id', id).eq('company_id', session.companyId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!canEditClient(session, clientAgent(row))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The path must actually be one of this client's own closing documents —
  // otherwise a caller who legitimately owns one client could sign a URL for
  // an unrelated document path just by guessing it.
  let attached = false
  try {
    const extras = JSON.parse((row.notes as string) || '{}')
    const docs = Array.isArray(extras?.closing?.documents) ? extras.closing.documents : []
    attached = docs.some((d: Record<string, unknown>) => d.path === path)
  } catch { /* not attached */ }
  if (!attached) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: signed, error } = await admin.storage.from(DOC_BUCKET).createSignedUrl(path, 60)
  if (error || !signed?.signedUrl) {
    console.error('[clients/document] sign error', error)
    return NextResponse.json({ error: 'Could not open document' }, { status: 500 })
  }
  return NextResponse.redirect(signed.signedUrl)
}
