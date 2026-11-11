import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseRecipients } from '@/lib/marketing-email'

// The signed-in agent's own email, and whether listings they send to marketing
// (or that are sent for them) come to it as a copy. Every member sets their own;
// nobody sets someone else's.
//
// Not the login email: an agent signs in with an agent ID, and the address
// behind it is often made up from the code — not an inbox anyone reads.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // select('*') so a missing migration 035 reads as "not set" rather than erroring.
  const { data } = await createAdminClient().from('Profiles').select('*').eq('id', session.userId).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({
    email: (row.copy_email as string | null) ?? '',
    marketingCopy: row.marketing_copy === true,
    available: 'marketing_copy' in row,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { email?: unknown; marketingCopy?: unknown }
  const update: Record<string, unknown> = {}

  if ('email' in body) {
    const raw = String(body.email ?? '').trim()
    if (raw) {
      const parsed = parseRecipients(raw)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      if (parsed.emails.length !== 1) return NextResponse.json({ error: 'Just one email address.' }, { status: 400 })
      update.copy_email = parsed.emails[0]
    } else {
      update.copy_email = null
      // No address, nothing to send a copy to.
      update.marketing_copy = false
    }
  }
  if ('marketingCopy' in body) update.marketing_copy = body.marketingCopy === true

  if (update.marketing_copy === true && !('copy_email' in update)) {
    const { data } = await createAdminClient().from('Profiles').select('*').eq('id', session.userId).maybeSingle()
    if (!String((data as Record<string, unknown> | null)?.copy_email ?? '').trim()) {
      return NextResponse.json({ error: 'Add your email first.' }, { status: 400 })
    }
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('Profiles').update(update).eq('id', session.userId).select('*').maybeSingle()
  if (error) {
    const missing = /copy_email|marketing_copy/.test(error.message)
    return NextResponse.json({ error: missing ? 'Not set up yet — database migration 035 needs to be run.' : error.message }, { status: 500 })
  }
  const row = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({ ok: true, email: (row.copy_email as string | null) ?? '', marketingCopy: row.marketing_copy === true })
}
