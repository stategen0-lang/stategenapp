'use client'

import { useCallback, useEffect, useState } from 'react'
import { HandCoins, MessageCircle, Check, X, Plus } from 'lucide-react'
import {
  negotiationState, NEGOTIATION_LABEL, sideLabel, money, vsAsking, otherSide,
  type NegotiationState, type OfferRound, type NegotiationStatus, type OfferSide,
} from '@/lib/offers'
import { dbRowToClient } from '@/lib/db-mappers'

type Negotiation = { dealId: string; clientId: number | null; clientName: string; agentCode: string | null; state: NegotiationState }

const H = '#1A2B4A'
const SUB = '#7A8499'

const STATUS_STYLE: Record<NegotiationStatus, { bg: string; color: string }> = {
  none:      { bg: '#F0F2F5', color: '#6A7488' },
  open:      { bg: '#FBEFD6', color: '#9A6516' },
  accepted:  { bg: '#E3F4EA', color: '#1F7A4D' },
  rejected:  { bg: '#FBE7E7', color: '#A23434' },
  withdrawn: { bg: '#F0F2F5', color: '#6A7488' },
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

const inp = 'rounded-lg px-2.5 py-1.5 text-sm outline-none'
const inpStyle = { border: '1.5px solid #D7DCE5', background: '#fff', color: H } as const

function Thread({ rounds }: { rounds: OfferRound[] }) {
  return (
    <div className="mt-2.5 space-y-1.5">
      {rounds.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          <span className="font-semibold px-1.5 py-0.5 rounded-md" style={{ background: r.side === 'buyer' ? '#EAF0FA' : '#EDEAFA', color: r.side === 'buyer' ? '#2E5288' : '#5E3B76' }}>{sideLabel(r.side)}</span>
          <span className="font-bold" style={{ color: H }}>{money(r.amount)}</span>
          {r.status !== 'pending' && (
            <span className="uppercase font-bold" style={{ color: STATUS_STYLE[r.status as NegotiationStatus]?.color ?? SUB, fontSize: 10 }}>{r.status}</span>
          )}
          <span className="ml-auto" style={{ color: '#9AA3B2' }}>{timeAgo(r.at)}</span>
        </div>
      ))}
    </div>
  )
}

export default function OffersSection({ propertyId, asking }: { propertyId: number; asking?: number | null }) {
  const [negs, setNegs] = useState<Negotiation[] | null>(null)
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [counterFor, setCounterFor] = useState<string | null>(null)
  const [counterAmt, setCounterAmt] = useState('')

  const [logging, setLogging] = useState(false)
  const [clients, setClients] = useState<{ id: number; name: string }[]>([])
  const [nClient, setNClient] = useState('')
  const [nAmt, setNAmt] = useState('')
  const [nSide, setNSide] = useState<OfferSide>('buyer')

  const load = useCallback(async () => {
    const d = await fetch(`/api/offers?propertyId=${propertyId}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    setNegs(Array.isArray(d?.negotiations) ? d.negotiations.map((n: Negotiation) => ({ ...n, state: negotiationState(n.state.rounds) })) : [])
  }, [propertyId])
  useEffect(() => { load() }, [load])

  async function loadClients() {
    if (clients.length) return
    const d = await fetch('/api/clients').then(r => (r.ok ? r.json() : null)).catch(() => null)
    if (Array.isArray(d?.clients)) {
      setClients(d.clients.map((row: Record<string, unknown>, i: number) => dbRowToClient(row, i)).map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })))
    }
  }

  async function logOffer(clientId: number, amount: number, side: OfferSide) {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId, clientId, amount, side }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Could not log the offer.'); return false }
      await load(); return true
    } finally { setBusy(false) }
  }

  async function resolve(dealId: string, decision: 'accept' | 'reject') {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/offers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, decision }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Could not update the offer.'); return }
      await load()
    } finally { setBusy(false) }
  }

  async function submitCounter(n: Negotiation) {
    const amt = parseInt(counterAmt, 10)
    if (!(amt > 0) || n.clientId == null) return
    const side = n.state.turn ?? otherSide(n.state.currentSide ?? 'buyer')
    if (await logOffer(n.clientId, amt, side)) { setCounterFor(null); setCounterAmt('') }
  }

  async function submitNew() {
    const amt = parseInt(nAmt, 10)
    if (!nClient || !(amt > 0)) { setError('Pick a client and enter an amount.'); return }
    if (await logOffer(Number(nClient), amt, nSide)) { setLogging(false); setNClient(''); setNAmt(''); setNSide('buyer') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HandCoins className="h-4 w-4" style={{ color: '#8A5A12' }} />
          <p className="text-sm font-bold" style={{ color: H }}>Offers &amp; negotiation{negs && negs.length > 0 ? ` (${negs.length})` : ''}</p>
        </div>
        <button
          onClick={() => { setLogging(v => !v); setError(''); loadClients() }}
          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg"
          style={{ background: '#0E1F3D', color: '#fff' }}
        >
          <Plus className="h-3.5 w-3.5" /> Log offer
        </button>
      </div>

      {/* New-offer form */}
      {logging && (
        <div className="rounded-xl p-3 mb-3" style={{ border: '1.5px solid #CFE0F5', background: '#F5F9FE' }}>
          <div className="grid grid-cols-2 gap-2">
            <select className={`${inp} col-span-2`} style={inpStyle} value={nClient} onChange={e => setNClient(e.target.value)}>
              <option value="">Choose a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className={inp} style={inpStyle} type="number" inputMode="numeric" placeholder="Amount (USD)" value={nAmt} onChange={e => setNAmt(e.target.value)} />
            <select className={inp} style={inpStyle} value={nSide} onChange={e => setNSide(e.target.value as OfferSide)}>
              <option value="buyer">Buyer offer</option>
              <option value="owner">Owner counter</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={() => setLogging(false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ border: '1.5px solid #EEF0F4', color: SUB }}>Cancel</button>
            <button onClick={submitNew} disabled={busy} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#1B8A4B' }}>{busy ? 'Saving…' : 'Log offer'}</button>
          </div>
        </div>
      )}

      {error && <p className="text-xs px-3 py-2 rounded-lg mb-2" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

      {negs === null ? (
        <p className="text-xs py-4 text-center" style={{ color: SUB }}>Loading…</p>
      ) : negs.length === 0 ? (
        <div className="rounded-xl p-4 text-center" style={{ border: '1.5px dashed #EEF0F4' }}>
          <p className="text-xs" style={{ color: SUB }}>No offers logged yet.</p>
          <p className="text-xs mt-1.5 inline-flex items-center gap-1.5" style={{ color: '#1B8A4B' }}>
            <MessageCircle className="h-3.5 w-3.5" /> Use “Log offer” above, or the WhatsApp assistant.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {negs.map(n => {
            const st = n.state
            const style = STATUS_STYLE[st.status]
            const vs = st.currentAmount != null ? vsAsking(st.currentAmount, asking) : ''
            const open = st.status === 'open'
            return (
              <div key={n.dealId} className="rounded-xl p-3" style={{ border: '1.5px solid #EEF0F4', background: '#FAFBFC' }}>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpenThread(o => o === n.dealId ? null : n.dealId)}>
                  <p className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: H }}>{n.clientName}</p>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: style.bg, color: style.color }}>{NEGOTIATION_LABEL[st.status]}</span>
                </div>
                {st.currentAmount != null && (
                  <p className="text-xs mt-1" style={{ color: SUB }}>
                    <span className="font-bold" style={{ color: H }}>{money(st.currentAmount)}</span>
                    {vs ? ` · ${vs}` : ''}
                    {open && st.turn ? ` · ${sideLabel(st.turn)} to respond` : ''}
                    {st.count > 1 ? ` · ${st.count} rounds` : ''}
                  </p>
                )}

                {/* Actions (open negotiations only) */}
                {open && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {counterFor === n.dealId ? (
                      <>
                        <input autoFocus className={inp} style={{ ...inpStyle, width: 130 }} type="number" inputMode="numeric" placeholder={`${sideLabel(st.turn ?? 'buyer')} amount`} value={counterAmt} onChange={e => setCounterAmt(e.target.value)} />
                        <button onClick={() => submitCounter(n)} disabled={busy} className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>Send</button>
                        <button onClick={() => { setCounterFor(null); setCounterAmt('') }} className="text-xs font-semibold px-2 py-1.5 rounded-lg" style={{ color: SUB }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setCounterFor(n.dealId); setCounterAmt('') }} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1.5px solid #CFE0F5', background: '#F5F9FE', color: '#2E5288' }}>Counter</button>
                        <button onClick={() => resolve(n.dealId, 'accept')} disabled={busy} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#1B8A4B' }}><Check className="h-3.5 w-3.5" /> Accept</button>
                        <button onClick={() => resolve(n.dealId, 'reject')} disabled={busy} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}><X className="h-3.5 w-3.5" /> Reject</button>
                      </>
                    )}
                  </div>
                )}

                {openThread === n.dealId && <Thread rounds={st.rounds} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
