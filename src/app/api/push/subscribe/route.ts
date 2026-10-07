import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'

// A device's push subscription.
//
// POST registers the browser in front of the agent; DELETE removes it. The
// switch in Settings is exactly these two calls — "notifications on this
// device" is the same question as "is there a row for this endpoint".
//
// The admin client writes it: push_subscriptions is service-role only, so no
// signed-in user can read anybody else's endpoints.

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const endpoint = String(body?.subscription?.endpoint ?? '')
  const p256dh = String(body?.subscription?.keys?.p256dh ?? '')
  const auth = String(body?.subscription?.keys?.auth ?? '')
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'That subscription is incomplete.' }, { status: 400 })
  }

  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert({
      company_id: session.companyId,
      profile_id: session.userId,
      agent_code: session.agentCode ?? null,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    }, { onConflict: 'endpoint' })

  if (error) {
    if (/push_subscriptions/.test(error.message)) {
      return NextResponse.json({ error: 'Run database migration 032 first.' }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const endpoint = String((await req.json().catch(() => ({})))?.endpoint ?? '')
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

  // Scoped to the company as well as the endpoint: an endpoint is unguessable,
  // but a delete should never reach outside the caller's own agency.
  await createAdminClient()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('company_id', session.companyId)

  return NextResponse.json({ ok: true })
}
