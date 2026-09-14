'use client'

import { useEffect, useRef, useState } from 'react'
import { Megaphone, Check } from 'lucide-react'
import type { Property } from '@/lib/data'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'

// "Send to marketing" — email a listing to the company's marketing team so they
// can post it on OLX / Instagram / Facebook. Two entry points share this file:
// the prompt shown right after a listing is added, and the button on a listing's
// details. Both only appear once a manager has set the marketing email.

const H = '#14223F'
const SUB = '#6A7488'

// The setting rarely changes during a session, so fetch it once per page load
// and share it across every prompt and button.
let cached: { configured: boolean; email: string | null } | undefined
let inflight: Promise<{ configured: boolean; email: string | null }> | null = null

function fetchConfig() {
  inflight ??= fetch('/api/company/marketing')
    .then(r => (r.ok ? r.json() : { configured: false, email: null }))
    .catch(() => ({ configured: false, email: null }))
    .then(d => { cached = { configured: !!d.configured, email: d.email ?? null }; inflight = null; return cached })
  return inflight
}

/** Forget the cached setting (Settings calls this after a manager saves it). */
export function refreshMarketingConfig() { cached = undefined }

export function useMarketingConfig() {
  const [config, setConfig] = useState(cached)
  useEffect(() => {
    if (cached) { setConfig(cached); return }
    let live = true
    fetchConfig().then(c => { if (live) setConfig(c) })
    return () => { live = false }
  }, [])
  return config
}

/** Who may send: the listing's own agent, or a manager (the server re-checks). */
export function useCanSendToMarketing(p: Pick<Property, 'agentId'>) {
  const { session, loading } = useSession()
  const config = useMarketingConfig()
  const allowed = !!session && (isManager(session.role) || (!!session.agentCode && session.agentCode === p.agentId))
  return { ready: config !== undefined && !loading, canSend: allowed && !!config?.configured, to: config?.email ?? null }
}

async function send(id: number): Promise<{ ok: true; sentAt: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/properties/marketing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: d.error ?? 'Could not send. Please try again.' }
    return { ok: true, sentAt: d.sentAt }
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

function sentLabel(at: string, by?: string) {
  const d = new Date(at)
  const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `Sent to marketing${when ? ` · ${when}` : ''}${by ? ` by ${by}` : ''}`
}

/**
 * Asked right after a new listing is saved. Renders nothing (and closes itself)
 * when sending isn't possible, so agents in a company without a marketing email
 * are never nagged.
 */
export function MarketingPrompt({ property: p, onClose }: { property: Property; onClose: () => void }) {
  const { ready, canSend, to } = useCanSendToMarketing(p)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Parents pass an inline arrow; a ref keeps the timers below from restarting
  // every time the page re-renders (a toast, a list refresh).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => { if (ready && !canSend) closeRef.current() }, [ready, canSend])
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => closeRef.current(), 1400)
    return () => clearTimeout(t)
  }, [done])

  if (!ready || !canSend) return null
  return <PromptDialog p={p} to={to} busy={busy} error={error} done={done} onClose={onClose}
    onSend={async () => {
      setBusy(true); setError('')
      const res = await send(p.id)
      setBusy(false)
      if (res.ok) setDone(true); else setError(res.error)
    }} />
}

function PromptDialog({ p, to, busy, error, done, onClose, onSend }: {
  p: Property; to: string | null; busy: boolean; error: string; done: boolean
  onClose: () => void; onSend: () => void
}) {
  useLockBodyScroll()
  const noPhotos = !(p.photos ?? []).length
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4"
      style={{ background: 'rgba(14,31,61,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="w-full md:max-w-sm rounded-t-2xl md:rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        {done ? (
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: '#E3F4EA' }}>
              <Check className="h-5 w-5" style={{ color: '#1F7A4D' }} />
            </div>
            <p className="text-base font-bold mt-3" style={{ color: H }}>Sent to marketing</p>
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#EAF0FA' }}>
              <Megaphone className="h-5 w-5" style={{ color: '#2E5288' }} />
            </div>
            <p className="text-base font-bold mt-3" style={{ color: H }}>Send this listing to marketing?</p>
            <p className="text-sm mt-1" style={{ color: SUB }}>
              <strong style={{ color: H }}>{p.title}</strong> will be emailed{to ? <> to <span className="break-all">{to}</span></> : ''} so it can be posted on OLX, Instagram and Facebook.
            </p>
            {noPhotos && (
              <p className="text-xs mt-2 rounded-lg px-3 py-2" style={{ background: '#FBF6EE', color: '#8A5A24' }}>
                This listing has no photos yet. You can send it later from the listing&apos;s details.
              </p>
            )}
            <p className="text-xs mt-2" style={{ color: '#9AA3B2' }}>The owner&apos;s details and private notes are never included.</p>
            {error && <p className="text-sm mt-3" style={{ color: '#C0392B' }}>{error}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} disabled={busy} className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                style={{ border: '1.5px solid #EEF0F4', color: SUB }}>
                Not now
              </button>
              <button onClick={onSend} disabled={busy} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: H }}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The button on a listing's details. Hidden when the viewer can't send it. */
export function SendToMarketingButton({ property: p }: { property: Property }) {
  const { canSend } = useCanSendToMarketing(p)
  const [sentAt, setSentAt] = useState(p.marketingSentAt)
  const [sentBy, setSentBy] = useState(p.marketingSentBy)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  if (!canSend) return null

  async function go() {
    setBusy(true); setError('')
    const res = await send(p.id)
    setBusy(false); setConfirming(false)
    if (res.ok) { setSentAt(res.sentAt); setSentBy(undefined) } else setError(res.error)
  }

  return (
    <div className="rounded-xl p-3" style={{ background: '#F7F8FB', border: '1px solid #EEF0F4' }}>
      <div className="flex items-center gap-3">
        <Megaphone className="h-4 w-4 shrink-0" style={{ color: '#2E5288' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: H }}>Marketing</p>
          <p className="text-xs truncate" style={{ color: SUB }}>
            {sentAt ? sentLabel(sentAt, sentBy) : 'Email it to the team for OLX, Instagram & Facebook'}
          </p>
        </div>
        {confirming ? (
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => setConfirming(false)} disabled={busy} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ border: '1.5px solid #EEF0F4', color: SUB, background: '#fff' }}>Cancel</button>
            <button onClick={go} disabled={busy} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60" style={{ background: H }}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white whitespace-nowrap" style={{ background: H }}>
            {sentAt ? 'Send again' : 'Send to marketing'}
          </button>
        )}
      </div>
      {error && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{error}</p>}
    </div>
  )
}
