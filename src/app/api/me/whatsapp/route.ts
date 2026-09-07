import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/whatsapp/phone'
import { generatePairingCode, connectLink, connectText, PAIRING_TTL_MINUTES } from '@/lib/whatsapp/pairing'

// The signed-in user's own WhatsApp connection.
//
//   GET    — current status (connected? number, enabled, opted-in when)
//   POST   — mint a pairing code + deep link to connect this account
//   PATCH  — pause/resume the assistant ({ enabled })
//   DELETE — disconnect (unbind the number)
//
// Writes go through the admin client after the session is verified, matching the
// other /api/me and /api/company endpoints (Companies/Profiles RLS is otherwise
// restrictive, and the Profiles-RLS recursion has broken authenticated reads).

const SELECT = 'whatsapp_number, whatsapp_enabled, whatsapp_opt_in_at, whatsapp_pending_code, whatsapp_pending_expires'

function botNumber(): string {
  // The production Cloud API sender's E.164 number, used to build the wa.me
  // connect deep link. Falls back to the old Twilio var during cutover.
  return normalizePhone(process.env.WHATSAPP_DISPLAY_NUMBER ?? process.env.TWILIO_WHATSAPP_NUMBER ?? '')
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // Try to include reminder_hour; fall back to the base columns if migration 015
  // hasn't been applied yet, defaulting the hour to 9.
  let res = await admin.from('Profiles').select(`${SELECT}, reminder_hour`).eq('id', session.userId).maybeSingle()
  if (res.error?.code === '42703') {
    res = await admin.from('Profiles').select(SELECT).eq('id', session.userId).maybeSingle()
  }
  const data = res.data as Record<string, unknown> | null

  return NextResponse.json({
    connected: !!data?.whatsapp_number,
    number: (data?.whatsapp_number as string | null) ?? null,
    enabled: data?.whatsapp_enabled !== false,
    optInAt: (data?.whatsapp_opt_in_at as string | null) ?? null,
    reminderHour: (data?.reminder_hour as number | null) ?? 9,
  })
}

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bot = botNumber()
  if (!bot) return NextResponse.json({ error: 'The WhatsApp bot number is not configured yet.' }, { status: 503 })

  const code = generatePairingCode()
  const expires = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000)

  const admin = createAdminClient()
  const { error } = await admin
    .from('Profiles')
    .update({ whatsapp_pending_code: code, whatsapp_pending_expires: expires.toISOString() })
    .eq('id', session.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    code,
    link: connectLink(bot, code),
    message: connectText(code),
    botNumber: bot,
    expiresInMinutes: PAIRING_TTL_MINUTES,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { enabled?: unknown; reminderHour?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if ('enabled' in body) update.whatsapp_enabled = !!body.enabled
  if ('reminderHour' in body) {
    const h = Number(body.reminderHour)
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      return NextResponse.json({ error: 'reminderHour must be an integer 0–23' }, { status: 400 })
    }
    update.reminder_hour = h
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from('Profiles').update(update).eq('id', session.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ...update })
}

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('Profiles')
    .update({ whatsapp_number: null, whatsapp_opt_in_at: null, whatsapp_pending_code: null, whatsapp_pending_expires: null })
    .eq('id', session.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, connected: false })
}
