// Attaching photos to a just-created listing over WhatsApp.
//
// After "add a listing" saves, applyPendingAction puts the agent into a short
// "collecting_photos" state (conversation_state). Each photo they then send is
// downloaded from Meta's media API, stored in the same bucket the web upload
// uses, and appended to the listing's Photos. "done" (or any other message)
// ends the window. Works inside WhatsApp's 24h service window — no template.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { downloadMedia, type InboundMessage } from '@/lib/whatsapp/cloud'
import { storePhotoBytes } from '@/lib/upload-server'

type Row = Record<string, unknown>
const DONE = /^(done|finish|finished|skip|no more|that'?s? (all|it)|stop)\b/i

export async function continuePhotoCollection(admin: SupabaseClient, profile: Profile, inbound: InboundMessage): Promise<string | null> {
  const { data: state } = await admin
    .from('conversation_state').select('current_flow, context, updated_at').eq('profile_id', profile.id).maybeSingle()
  if (!state || state.current_flow !== 'collecting_photos') return null

  const clear = () => admin.from('conversation_state').delete().eq('profile_id', profile.id)
  if (state.updated_at && Date.now() - new Date(state.updated_at).getTime() > 24 * 3600_000) { await clear(); return null }

  const ctx = (state.context ?? {}) as { propertyId?: number; count?: number }
  const propertyId = Number(ctx.propertyId)
  const count = Number(ctx.count) || 0

  // A photo → fetch from Meta, store, append to the listing.
  if (inbound.image) {
    const dl = await downloadMedia(inbound.image.id)
    if (!dl.ok) return `Couldn't fetch that photo — please resend it, or reply "done".`
    const up = await storePhotoBytes(admin, profile.company_id, dl.bytes)
    if (!up.ok) return `${up.error} Try another photo, or reply "done".`

    const { data: prop } = await admin.from('Properties').select('Photos').eq('id', propertyId).eq('company_id', profile.company_id).maybeSingle()
    let photos: string[] = []
    try { photos = JSON.parse(((prop as Row | null)?.Photos as string) || '[]') } catch { photos = [] }
    photos.push(up.url)
    await admin.from('Properties').update({ Photos: JSON.stringify(photos) }).eq('id', propertyId).eq('company_id', profile.company_id)

    const n = photos.length
    await admin.from('conversation_state').update({ context: { propertyId, count: n }, updated_at: new Date().toISOString() }).eq('profile_id', profile.id)
    return `📸 Photo ${n} saved to #${propertyId}. Send more, or reply "done".`
  }

  // "done"/"skip" ends the window.
  if (DONE.test(inbound.text.trim())) {
    await clear()
    return count > 0
      ? `✅ #${propertyId} now has ${count} photo${count === 1 ? '' : 's'}.`
      : `No photos added to #${propertyId} — you can add them on the web anytime.`
  }

  // Anything else: end collection quietly and let the message route normally.
  await clear()
  return null
}
