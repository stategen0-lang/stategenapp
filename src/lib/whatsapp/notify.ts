import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplate, sendText } from './cloud'
import { newClientLine, type NewClientInfo } from './notify-copy'

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

  const line = newClientLine(client)

  const templateName = process.env.WHATSAPP_NEW_CLIENT_TEMPLATE
  if (templateName) {
    const lang = process.env.WHATSAPP_NEW_CLIENT_TEMPLATE_LANG || 'en'
    const res = await sendTemplate(number, templateName, lang, [
      { type: 'body', parameters: [{ type: 'text', text: line }] },
    ])
    return { notified: res.ok, reason: res.ok ? undefined : 'template send failed' }
  }

  // No template configured — try free text (only lands inside the 24h window).
  const res = await sendText(number, line)
  return { notified: res.ok, reason: res.ok ? undefined : 'no template; outside 24h window' }
}
