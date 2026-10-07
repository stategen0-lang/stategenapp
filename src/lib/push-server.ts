// Sending a phone notification.
//
// Server-only. Everything here fails soft: a notification that cannot be sent
// must never fail the thing that caused it — an agent's listing saves whether
// or not a colleague's phone buzzes.
//
// Without VAPID keys configured there is simply no push. The in-app alerts are
// still written, so the feature degrades to what the app did before rather than
// erroring.

import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import type { PushPayload } from '@/lib/push-copy'

type Row = Record<string, unknown>

let configured: boolean | null = null

/** VAPID identifies this server to the push services. Set once, at boot. */
function ready(): boolean {
  if (configured !== null) return configured
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    console.error('[push] VAPID keys are not set — no notifications will be sent.')
    configured = false
    return false
  }
  // The subject is a contact address the push service can reach if this server
  // misbehaves; mailto is what the spec asks for.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:stategen0@gmail.com', publicKey, privateKey)
  configured = true
  return true
}

/**
 * Send one notification to every device belonging to these agents.
 *
 * Returns how many devices were reached. A subscription the push service
 * rejects as gone (404/410) is deleted — a phone that was reset or an app that
 * was uninstalled, and keeping it would mean retrying forever.
 */
export async function pushToAgents(
  admin: SupabaseClient,
  companyId: number,
  agentCodes: string[],
  payload: PushPayload,
): Promise<number> {
  if (!ready()) return 0
  const codes = [...new Set(agentCodes.filter(Boolean))]
  if (!codes.length) return 0

  try {
    const { data } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('company_id', companyId)
      .in('agent_code', codes)

    const devices = (data ?? []) as Row[]
    if (!devices.length) return 0

    const body = JSON.stringify(payload)
    const dead: number[] = []
    let sent = 0

    await Promise.all(devices.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint as string, keys: { p256dh: d.p256dh as string, auth: d.auth as string } },
          body,
        )
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) dead.push(Number(d.id))
        else console.error('[push] send failed', status ?? err)
      }
    }))

    if (dead.length) {
      await admin.from('push_subscriptions').delete().in('id', dead)
    }
    return sent
  } catch (err) {
    console.error('[push] could not send', err)
    return 0
  }
}
