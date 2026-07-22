import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySignature, twimlMessage } from '@/lib/whatsapp/twilio'
import { normalizePhone } from '@/lib/whatsapp/phone'
import { parseConfirmation, parseReminderReply } from '@/lib/whatsapp/replies'
import { classifyIntent, Intent } from '@/lib/whatsapp/intent'
import { handleQueryClient, handleQueryProperty, HELP_TEXT } from '@/lib/whatsapp/handlers'
import {
  stageClientUpdate, stagePropertyUpdate, stageFeedback,
  applyPendingAction, handleReminderReply,
} from '@/lib/whatsapp/write-handlers'
import { startCreatePropertyFlow, continueFlow } from '@/lib/whatsapp/flow-handlers'
import { isStartListing } from '@/lib/whatsapp/flows'
import { handleAgentActivity, handleOverdueReminders } from '@/lib/whatsapp/manager-handlers'
import { stageCreateEvent, handleQuerySchedule } from '@/lib/whatsapp/calendar-handlers'
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
): Promise<string | null> {
  try {
    const { data } = await admin.from('whatsapp_logs').insert(row).select('id').maybeSingle()
    return (data?.id as string) ?? null
  } catch {
    return null   // logging must never break a reply
  }
}

/**
 * Decide the reply. Split out from POST so each branch simply returns, rather
 * than assigning into a variable that later branches could still overwrite.
 *
 * Order matters, and the handlers must stay inline: several of them write to
 * the database, so hoisting one into a const above the branches applies it even
 * when a different branch ends up answering. That bug shipped briefly in Phase 4.
 */
async function route(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
): Promise<{ intent: Intent | 'confirm_pending'; answer: string }> {
  // A write waiting on "yes" outranks anything a model might infer.
  const { data: pending } = await admin
    .from('pending_actions')
    .select('id, action_type, summary, payload, expires_at')
    .eq('profile_id', profile.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const confirmation = parseConfirmation(body)

  if (pending && confirmation !== 'unknown') {
    // Consume the action first, whichever way it goes: a pending write must
    // never be applicable twice.
    await admin.from('pending_actions').delete().eq('id', pending.id)
    return {
      intent: 'confirm_pending',
      answer: confirmation === 'confirm'
        ? await applyPendingAction(admin, profile, pending.action_type, pending.payload)
        : 'Cancelled — nothing was saved.',
    }
  }

  // Mid-flow, per the spec's router: an agent answering "Villa" to "what type?"
  // must not have that re-read as a fresh intent.
  const flowAnswer = await continueFlow(admin, profile, body)
  if (flowAnswer !== null) return { intent: 'create_property', answer: flowAnswer }

  // "done" / "snooze 3d" / "not interested" only mean what they appear to while
  // a reminder is outstanding; otherwise this returns null and the message
  // falls through to normal classification.
  const reminderReply = parseReminderReply(body)
  if (reminderReply.action !== 'unknown') {
    const reminderAnswer = await handleReminderReply(admin, profile, reminderReply.action, reminderReply.snoozeDays, body)
    if (reminderAnswer !== null) return { intent: 'reminder_response', answer: reminderAnswer }
  }

  if (confirmation !== 'unknown') {
    // A yes/no with nothing staged. Answering this locally matters: sending it
    // to the model returns "I didn't understand", which reads as though the
    // change might still be pending when in fact nothing is.
    return {
      intent: confirmation,
      answer: 'There is nothing waiting for confirmation — it may have expired (confirmations last 10 minutes). Send the change again.',
    }
  }

  const result = await classifyIntent(body)

  // Grok is still asked, so any details in the message are extracted and the
  // flow can skip questions — but the routing decision is ours when the wording
  // is unambiguous.
  const intent = isStartListing(body) ? 'create_property' : result.intent

  switch (intent) {
    case 'query_client':   return { intent, answer: await handleQueryClient(admin, profile, result) }
    case 'query_property': return { intent, answer: await handleQueryProperty(admin, profile, result) }
    case 'query_agents':   return { intent, answer: await handleAgentActivity(admin, profile) }
    case 'query_overdue':  return { intent, answer: await handleOverdueReminders(admin, profile) }
    case 'query_schedule': return { intent, answer: await handleQuerySchedule(admin, profile, body) }
    // Dates are inferred from prose, so this stages a confirmation like every
    // other write rather than booking straight away.
    case 'create_event':   return { intent, answer: await stageCreateEvent(admin, profile, body) }
    case 'help':           return { intent, answer: HELP_TEXT }
    case 'update_client':  return { intent, answer: await stageClientUpdate(admin, profile, result) }
    case 'update_property':return { intent, answer: await stagePropertyUpdate(admin, profile, result) }
    // Starts the multi-step flow, which finishes at the same confirmation step.
    case 'create_property':return { intent, answer: await startCreatePropertyFlow(admin, profile, result) }
    case 'feedback':       return { intent, answer: await stageFeedback(admin, profile, result, body) }
    // Only reached for phrasings the local matcher missed ("go on then").
    case 'confirm':
    case 'cancel':
      return { intent, answer: 'There is nothing waiting for confirmation — it may have expired (confirmations last 10 minutes). Send the change again.' }
    // Grok read it as a reminder reply, but nothing is outstanding — otherwise
    // the local matcher above would have handled it.
    case 'reminder_response':
      return { intent, answer: `You have no follow-up reminders waiting.\n\n${HELP_TEXT}` }
    default:
      return { intent, answer: `Sorry, I didn't understand that.\n\n${HELP_TEXT}` }
  }
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

  // Logged before routing so an inbound message survives even if a handler
  // throws; the resolved intent is written back onto this row afterwards.
  const inboundLogId = await log(admin, {
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
    const routed = await route(admin, profile, body)
    intent = routed.intent
    answer = routed.answer
  } catch (err) {
    console.error('[whatsapp] handler error', err)
    intent = 'unknown'
    answer = 'Something went wrong on my side. Please try again in a moment.'
  }

  if (inboundLogId) {
    try { await admin.from('whatsapp_logs').update({ intent }).eq('id', inboundLogId) } catch { /* never break a reply */ }
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
