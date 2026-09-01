import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'

// Manager-only: generate + list single-use agent invite links for the company.
// The token is opaque and random; the /join/<token> page + /api/invites/accept
// consume it exactly once (see migration 020).

const DEFAULT_TTL_DAYS = 14

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('invites')
    .select('id, token, created_at, expires_at')
    .eq('company_id', session.companyId)
    .is('used_at', null)
    .order('created_at', { ascending: false })

  const now = Date.now()
  const invites = (data ?? []).filter(i => !i.expires_at || new Date(i.expires_at as string).getTime() > now)
  return NextResponse.json({ invites })
}

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const token = crypto.randomBytes(18).toString('base64url')   // ~24 chars, unguessable
  const expires_at = new Date(Date.now() + DEFAULT_TTL_DAYS * 86400_000).toISOString()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invites')
    .insert({ token, company_id: session.companyId, created_by: session.userId, expires_at })
    .select('id, token, created_at, expires_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ invite: data })
}

// Revoke a live invite (manager decides a link should stop working before use).
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  // Scope the delete to the manager's own company, and only while still unused.
  const { error } = await admin.from('invites').delete()
    .eq('id', id).eq('company_id', session.companyId).is('used_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
