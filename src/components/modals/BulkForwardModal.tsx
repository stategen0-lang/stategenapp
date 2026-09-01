'use client'

import { useEffect, useMemo, useState } from 'react'
import { Client, Property, PROPERTIES, formatPrice } from '@/lib/data'
import { dbRowToProperty } from '@/lib/db-mappers'

// Bulk-forward a single listing to a group of the agent's own clients (e.g. all
// "Hot" clients). It never messages anyone itself — the bot must not contact
// clients (product rule). Instead it prepares one WhatsApp deep-link per client
// that opens the agent's OWN WhatsApp with the message pre-filled; the agent
// taps send. A per-client checkmark tracks who has been sent.

interface Props {
  clients: Client[]        // recipients (already filtered to own + has-phone)
  tagLabel: string | null  // the active tag filter, for the heading
  onClose: () => void
}

export default function BulkForwardModal({ clients, tagLabel, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [pool, setPool] = useState<Property[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Property | null>(null)
  const [url, setUrl] = useState('')
  const [minting, setMinting] = useState(false)
  const [sent, setSent] = useState<Record<number, boolean>>({})

  // Only Available listings are worth forwarding.
  useEffect(() => {
    let alive = true
    fetch('/api/properties')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive) return
        const list: Property[] = Array.isArray(d?.properties) ? d.properties.map(dbRowToProperty) : PROPERTIES
        setPool(list.filter(p => p.status === 'Available'))
      })
      .catch(() => setPool(PROPERTIES.filter(p => p.status === 'Available')))
    return () => { alive = false }
  }, [])

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? pool.filter(p => `${p.title} ${p.district} ${p.city}`.toLowerCase().includes(q))
      : pool
    return base.slice(0, 40)
  }, [pool, search])

  async function pick(p: Property) {
    setPicked(p)
    setMinting(true)
    let link = ''
    try {
      const r = await fetch(`/api/share?id=${p.id}`)
      if (r.ok) link = (await r.json()).url ?? ''
    } catch { /* forward without a link rather than block */ }
    setUrl(link)
    setMinting(false)
    setStep(2)
  }

  function waLink(c: Client): string {
    const first = c.name.split(' ')[0]
    const price = picked
      ? (picked.transaction === 'For Rent' ? `${formatPrice(picked.rent)}/mo` : formatPrice(picked.price))
      : ''
    const msg = `Hi ${first}, I found a listing that might suit you — ${picked?.title}${price ? ` (${price})` : ''}.${url ? `\n${url}` : ''}`
    return `https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
  }

  function send(c: Client) {
    window.open(waLink(c), '_blank')
    setSent(prev => ({ ...prev, [c.id]: true }))
  }

  const sentCount = Object.values(sent).filter(Boolean).length
  const heading = tagLabel ? `Forward to ${tagLabel} clients` : 'Forward a listing'

  const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none'
  const inpStyle = { border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: '#14223F' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
      style={{ background: 'rgba(14,31,61,0.45)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full md:max-w-md md:rounded-2xl rounded-t-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <div>
            <p className="text-base font-bold" style={{ color: '#14223F' }}>{heading}</p>
            <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>
              {step === 1 ? `Pick a listing to send to ${clients.length} client${clients.length === 1 ? '' : 's'}` : `${sentCount} of ${clients.length} sent`}
            </p>
          </div>
          <button onClick={onClose} style={{ color: '#9AA3B2' }} className="hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {step === 1 ? (
          <div className="p-5 space-y-3">
            <input className={inp} style={inpStyle} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listings…" autoFocus />
            <div className="space-y-2 overflow-y-auto max-h-[55vh]">
              {results.length === 0 && (
                <p className="text-center py-8 text-sm" style={{ color: '#9AA3B2' }}>No available listings found.</p>
              )}
              {results.map(p => (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  disabled={minting}
                  className="w-full text-left rounded-xl p-3 transition-colors disabled:opacity-60"
                  style={{ border: '1.5px solid #EEF0F4', background: '#FAFBFC' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: '#14223F' }}>{p.title}</p>
                    <p className="text-sm font-extrabold whitespace-nowrap" style={{ color: '#1F7A4D' }}>
                      {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
                    </p>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>{p.type} · {p.district}, {p.city}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-2 overflow-y-auto max-h-[55vh]">
              <div className="rounded-xl p-3 mb-1" style={{ background: '#F0F5FF', border: '1px solid #DCE7FB' }}>
                <p className="text-xs font-bold" style={{ color: '#2E5288' }}>{picked?.title}</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#6A7488' }}>
                  {url ? 'Tap a client to open WhatsApp with the message ready — you send it.' : 'Link unavailable — the message will go without it.'}
                </p>
              </div>
              {clients.map(c => {
                const done = sent[c.id]
                return (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ border: '1.5px solid #EEF0F4' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#14223F' }}>{c.name}</p>
                      <p className="text-xs truncate" style={{ color: '#9AA3B2' }}>{c.phone}</p>
                    </div>
                    <button
                      onClick={() => send(c)}
                      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                      style={done ? { background: '#E3F4EA', color: '#1F7A4D' } : { background: '#25D366', color: '#fff' }}
                    >
                      {done ? '✓ Sent' : 'Send'}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={() => { setStep(1); setPicked(null); setSent({}) }} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
                ← Pick another
              </button>
              <button onClick={onClose} className="flex-1 rounded-xl py-2 text-sm font-bold text-white" style={{ background: '#0E1F3D' }}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
