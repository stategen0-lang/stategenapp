import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManager } from '@/lib/permissions'
import { parseRecipients } from '@/lib/marketing-email'

// The marketing team's address(es) that "Send to marketing" delivers to.
// GET is open to any signed-in member — agents need to know whether sending is
// set up before offering it. PATCH is managers only.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // select('*') so a missing migration 023 reads as "not set up" rather than erroring.
  const { data } = await admin.from('Companies').select('*').eq('id', session.companyId).maybeSingle()
  const email = ((data as Record<string, unknown> | null)?.marketing_email as string | null) ?? null
  return NextResponse.json({ email, configured: !!email })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { email?: unknown }
  let value: string | null = null
  if (body.email !== null && String(body.email ?? '').trim() !== '') {
    const parsed = parseRecipients(body.email)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    value = parsed.emails.join(', ')
  }

  const admin = createAdminClient()
  const { error } = await admin.from('Companies').update({ marketing_email: value }).eq('id', session.companyId)
  if (error) {
    const missing = /marketing_email/.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Run database migration 023 first.' : error.message },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true, email: value, configured: !!value })
}
