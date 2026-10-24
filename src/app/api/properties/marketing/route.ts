import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendListingToMarketing } from '@/lib/marketing-send'

// "Send to marketing" from the web: email a listing to the company's marketing
// team. Permissions, content and the send itself live in marketing-send.ts,
// shared with the WhatsApp bot.

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { id?: unknown }
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid listing id is required.' }, { status: 400 })

  const result = await sendListingToMarketing(createAdminClient(), session, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, sentAt: result.sentAt, to: result.to })
}
