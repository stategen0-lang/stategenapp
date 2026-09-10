import { createAdminClient } from '@/lib/supabase/admin'
import { waNumber } from '@/lib/dedupe'
import { sendTemplate, sendText } from './cloud'
import { newClientLine, newClientCore, type NewClientInfo } from './notify-copy'

// Notify the OWNING AGENT (on their own WhatsApp) that a client was assigned to
// them, so they reach out. The bot never messages the client — this only ever
// goes to an agent (the client-contact product rule).
//
// A business-initiated message OUTSIDE WhatsApp's 24h window needs an APPROVED
// template (as the reminders do). Set env WHATSAPP_NEW_CLIENT_TEMPLATE to its
// name; the body must have ONE {{1}} param. Without it we fall back to free text,
// which Meta only delivers if the agent messaged the bot in the last 24h — so
// configure the template for reliable delivery. Best-effort and non-fatal.

interface NotifyOpts {
  companyId: number
  ownerAgentCode: string | null   // Profiles.agent_code of the responsible agent
  actorAgentCode?: string | null  // who created it — skip if they own it themselves
  client: NewClientInfo
}

export async function notifyAgentNewClient(opts: NotifyOpts): Promise<{ notified: boolean; reason?: string }> {
  const { companyId, ownerAgentCode, actorAgentCode, client } = opts
  if (!ownerAgentCode) return { notified: false, reason: 'no owning agent' }
  // The agent who just added their own client already knows — don't ping them.
  if (actorAgentCode && actorAgentCode === ownerAgentCode) return { notified: false, reason: 'owner is creator' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('Profiles')
    .select('whatsapp_number, whatsapp_enabled')
    .eq('company_id', companyId)
    .eq('agent_code', ownerAgentCode)
    .maybeSingle()

  const number = (profile?.whatsapp_number as string | undefined) ?? undefined
  if (!number || profile?.whatsapp_enabled === false) return { notified: false, reason: 'agent has no WhatsApp' }

  const templateName = process.env.WHATSAPP_NEW_CLIENT_TEMPLATE
  const wa = waNumber(client.phone)   // the client's number, for the chat button

  // 1) Approved template first — the ONLY thing Meta delivers outside the agent's
  //    24h window. Body {{1}} is the client data. The tap-to-chat URL button is
  //    added only when we know the client's number; a client with no phone still
  //    gets a body-only template (it used to skip the template entirely and fall
  //    to free text, which silently vanished outside the window).
  if (templateName) {
    const lang = process.env.WHATSAPP_NEW_CLIENT_TEMPLATE_LANG || 'en'
    const components: unknown[] = [
      { type: 'body', parameters: [{ type: 'text', text: newClientCore(client) }] },
    ]
    // The button resolves through /wa to the client's chat in the AGENT'S own
    // WhatsApp — the agent reaches out, the bot never messages the client.
    if (wa) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: wa }] })

    const res = await sendTemplate(number, templateName, lang, components)
    if (res.ok) return { notified: true }
    // Wrong name / not approved / param mismatch — surface it, then still try
    // free text so an in-window agent is notified rather than nothing happening.
    console.warn('[notify] template send failed:', res.error)
  }

  // 2) Free text — only lands if the agent messaged the bot in the last 24h.
  const res = await sendText(number, newClientLine(client))
  if (!res.ok) console.warn('[notify] free-text send failed:', res.error)
  return { notified: res.ok, reason: res.ok ? undefined : (res.error ?? 'not delivered') }
}
