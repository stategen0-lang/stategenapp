// "Send to marketing" over WhatsApp.
//
// Two ways in, one send (marketing-send.ts, shared with the web button):
//   • After an agent adds a listing and replies "done" on its photos, the bot
//     offers to send it — only when sending would actually work.
//   • "send #45 to marketing" at any time.
// Either way the email goes out only after the agent confirms (a staged
// pending_action), like every other outward action the bot takes.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotReply } from '@/lib/whatsapp/cloud'
import { stage, type Profile } from '@/lib/whatsapp/write-handlers'
import { marketingEligibility, type MarketingActor } from '@/lib/marketing-send'

export function actorOf(profile: Profile): MarketingActor {
  return {
    userId: profile.id,
    companyId: profile.company_id,
    role: profile.role as MarketingActor['role'],
    agentCode: profile.agent_code,
    fullName: profile.Full_name ?? 'Agent',
  }
}

// Button titles also parse as YES / NO (replies.ts), so a tap confirms or skips.
const BUTTONS = [
  { id: 'marketing_yes', title: 'Yes, send it' },
  { id: 'marketing_no', title: 'No, not now' },
]

async function stageSend(
  admin: SupabaseClient, profile: Profile, propertyId: number, title: string, to: string[], origin: string, lead: string,
): Promise<BotReply> {
  const question = `${lead}📧 Send #${propertyId} "${title}" to marketing (${to.join(', ')})?`
  const staged = await stage(admin, profile, 'send_marketing', question, {
    table: 'marketing', id: propertyId, columns: {}, extras: { origin }, label: title,
  })
  // stage() returns our text on success and its own error text otherwise.
  if (staged !== question) return staged
  return { text: question, buttons: BUTTONS }
}

/**
 * The offer after "done" on a new listing's photos. Returns null when sending
 * isn't possible (no marketing email set up, not this agent's listing…), so the
 * agent is never asked something that would only fail.
 */
export async function offerMarketing(
  admin: SupabaseClient, profile: Profile, propertyId: number, origin: string, lead: string,
): Promise<BotReply | null> {
  const eligible = await marketingEligibility(admin, actorOf(profile), propertyId)
  if (!eligible.ok) return null
  return stageSend(admin, profile, propertyId, eligible.title, eligible.to, origin, lead)
}

/** "send #45 to marketing": stage it, or say plainly why it can't be sent. */
export async function requestMarketing(
  admin: SupabaseClient, profile: Profile, propertyId: number, origin: string,
): Promise<BotReply> {
  const eligible = await marketingEligibility(admin, actorOf(profile), propertyId)
  if (!eligible.ok) return eligible.error
  return stageSend(admin, profile, propertyId, eligible.title, eligible.to, origin, '')
}
