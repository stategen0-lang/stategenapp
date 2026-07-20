import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySignature, twimlMessage } from '@/lib/whatsapp/twilio'
import { normalizePhone } from '@/lib/whatsapp/phone'
import { parseConfirmation } from '@/lib/whatsapp/replies'
import { classifyIntent, Intent } from '@/lib/whatsapp/intent'
import { handleQueryClient, handleQueryProperty, HELP_TEXT } from '@/lib/whatsapp/handlers'
import type { SupabaseClient } from '@supabase/supabase-js'

// Twilio posts form-encoded data and expects TwiML back.
const XML = { 'Content-Type': 'text/xml; charset=utf-8' }

function reply(body: string) {
  return new Response(twimlMessage(body), { status: 200, headers: XML })
}

/**
 * The public URL Twilio signed. Behind Vercel's proxy the internal request URL
 * is http and carries the internal host, so the signature must be checked
 * against the forwarded values instead.
 */
function publicUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`
}

interface Profile {
  id: string
  company_id: number
  role: string
  agent_code: string | null
  Full_name: string | null
  whatsapp_number: string | null
}

async function log(
  admin: SupabaseClient,
  row: {
    company_id?: number | null
    profile_id?: string | null
    from_number?: string | null
    direction: 'inbound' | 'outbound'
    message: string
    intent?: string | null
  },
) {
  try { await admin.from('whatsapp_logs').insert(row) } catch { /* logging must never break a reply */ }
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[whatsapp] TWILIO_AUTH_TOKEN is not set')
    return new Response('Not configured', { status: 500 })
  }

  // ── Read the form body into a plain object (needed for the signature) ──────
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  // ── Authenticate the request ──────────────────────────────────────────────
  // Without this, anyone who learns the URL could forge `From` and impersonate
  // an agent, gaining full read/write access to that company's data.
  const signature = req.headers.get('x-twilio-signature')
  if (!verifySignature(authToken, signature, publicUrl(req), params)) {
    console.warn('[whatsapp] rejected request with an invalid signature')
    return new Response('Invalid signature', { status: 403 })
  }

  const from = params.From ?? ''
  const body = (params.Body ?? '').trim()
  const admin = createAdminClient()

  // ── Identify the agent by the number they messaged from ───────────────────
  const phone = normalizePhone(from)
  const { data: profile } = await admin
    .from('Profiles')
    .select('id, company_id, role, agent_code, Full_name, whatsapp_number')
    .eq('whatsapp_number', phone)
    .maybeSingle<Profile>()

  if (!profile) {
    await log(admin, { from_number: phone, direction: 'inbound', message: body, intent: 'unregistered' })
    return reply('You are not registered. Contact your admin to get access.')
  }

  await log(admin, {
    company_id: profile.company_id,
    profile_id: profile.id,
    from_number: phone,
    direction: 'inbound',
    message: body,
  })

  // ── Route ─────────────────────────────────────────────────────────────────
  let answer: string
  let intent: Intent | 'confirm_pending' = 'unknown'

  try {
    // Confirmations are checked first and locally: if a write is waiting on a
    // "yes", that meaning takes priority over anything a model might infer.
    const { data: pending } = await admin
      .from('pending_actions')
      .select('id, action_type, summary, expires_at')
      .eq('profile_id', profile.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const confirmation = parseConfirmation(body)
    if (pending && confirmation !== 'unknown') {
      intent = 'confirm_pending'
      // Phase 3 performs the write; for now the pending action is cleared so a
      // stale one can't linger and be applied later by mistake.
      await admin.from('pending_actions').delete().eq('id', pending.id)
      answer = confirmation === 'confirm'
        ? 'Confirmed — saving is not switched on yet, so nothing was written. (Coming in the next update.)'
        : 'Cancelled — nothing was saved.'
    } else {
      const result = await classifyIntent(body)
      intent = result.intent

      switch (result.intent) {
        case 'query_client':
          answer = await handleQueryClient(admin, profile, result)
          break
        case 'query_property':
          answer = await handleQueryProperty(admin, profile, result)
          break
        case 'help':
          answer = HELP_TEXT
          break
        case 'confirm':
        case 'cancel':
          answer = 'There is nothing waiting for confirmation.'
          break
        // Write flows land in Phase 3; say so plainly rather than pretending.
        case 'update_client':
        case 'update_property':
        case 'create_property':
        case 'feedback':
        case 'reminder_response':
          answer = `I understood that as "${result.intent.replace(/_/g, ' ')}", but that flow isn't switched on yet.\n\nFor now I can answer questions — try "info on <client name>" or "what matches 500k in Beirut".`
          break
        default:
          answer = `Sorry, I didn't understand that.\n\n${HELP_TEXT}`
      }
    }
  } catch (err) {
    console.error('[whatsapp] handler error', err)
    answer = 'Something went wrong on my side. Please try again in a moment.'
  }

  await log(admin, {
    company_id: profile.company_id,
    profile_id: profile.id,
    from_number: phone,
    direction: 'outbound',
    message: answer,
    intent,
  })

  return reply(answer)
}

// Twilio pings the URL with GET when you save it in the console.
export async function GET() {
  return new Response('StateGen WhatsApp webhook is running.', { status: 200 })
}
