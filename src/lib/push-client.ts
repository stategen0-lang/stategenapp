// Turning phone notifications on and off, from the browser.
//
// A push subscription belongs to a DEVICE, not to a person: the same agent on a
// phone and a laptop has two, and the switch in Settings governs the one they
// are holding. That is also the only honest thing to show them — a toggle that
// claimed to speak for every device would be lying, because the browser
// permission it depends on is per-device too.

/** Why notifications cannot be switched on here, or null when they can. */
export type PushBlocker =
  | 'unsupported'   // the browser has no push at all
  | 'install'       // iOS: only an installed (Home Screen) app may ask
  | 'denied'        // the person said no, and only their browser settings undo it
  | 'unconfigured'  // no VAPID key shipped — a server-side omission
  | null

export function pushBlocker(): PushBlocker {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // On an iPhone this is what Safari looks like until the app is added to the
    // Home Screen, so say the useful thing rather than "unsupported".
    return isIOS() && !isStandalone() ? 'install' : 'unsupported'
  }
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  return null
}

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)   // iPadOS

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || (navigator as { standalone?: boolean }).standalone === true

/** Is this device already subscribed? */
export async function isSubscribed(): Promise<boolean> {
  if (pushBlocker() !== null && pushBlocker() !== 'denied') return false
  try {
    const reg = await navigator.serviceWorker.ready
    return !!(await reg.pushManager.getSubscription())
  } catch { return false }
}

/**
 * The VAPID public key, in the byte form PushManager wants.
 *
 * Built on an explicit ArrayBuffer: a plain Uint8Array is typed as possibly
 * backed by a SharedArrayBuffer, which applicationServerKey does not accept.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/**
 * Ask for permission, subscribe this device, and register it with the server.
 * Returns an error message to show, or null on success.
 */
export async function enablePush(): Promise<string | null> {
  const blocked = pushBlocker()
  if (blocked === 'install') return 'On iPhone, add StateGen to your Home Screen first — Safari only allows notifications for the installed app.'
  if (blocked === 'denied') return 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
  if (blocked === 'unconfigured') return 'Notifications are not configured on the server yet.'
  if (blocked) return 'This browser cannot show notifications.'

  try {
    if ((await Notification.requestPermission()) !== 'granted') {
      return 'Notifications were not allowed.'
    }
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,   // required: every push must show something
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string),
    })
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    })
    if (!res.ok) {
      // Leave no half-state: if the server would not record it, this device
      // must not hold a subscription that nothing will ever send to.
      await subscription.unsubscribe().catch(() => {})
      return (await res.json().catch(() => ({})))?.error ?? 'Could not turn notifications on.'
    }
    return null
  } catch {
    return 'Could not turn notifications on.'
  }
}

/** Unsubscribe this device and forget it server-side. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
  } catch { /* already gone */ }
}
