'use client'

import { useEffect, useState } from 'react'
import { HandCoins, MessageCircle } from 'lucide-react'
import {
  negotiationState, NEGOTIATION_LABEL, sideLabel, money, vsAsking,
  type NegotiationState, type OfferRound, type NegotiationStatus,
} from '@/lib/offers'

type Negotiation = { dealId: string; clientName: string; agentCode: string | null; state: NegotiationState }

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

function Thread({ rounds }: { rounds: OfferRound[] }) {
  return (
    <div className="mt-2.5 space-y-1.5">
      {rounds.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          <span className="font-semibold px-1.5 py-0.5 rounded-md" style={{ background: r.side === 'buyer' ? '#EAF0FA' : '#EDEAFA', color: r.side === 'buyer' ? '#2E5288' : '#5E3B76' }}>
            {sideLabel(r.side)}
          </span>
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
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/offers?propertyId=${propertyId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setNegs(Array.isArray(d?.negotiations)
        // Rebuild state client-side so ordering/derivation stays in one place.
        ? d.negotiations.map((n: Negotiation) => ({ ...n, state: negotiationState(n.state.rounds) }))
        : []))
      .catch(() => setNegs([]))
  }, [propertyId])

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <HandCoins className="h-4 w-4" style={{ color: '#8A5A12' }} />
        <p className="text-sm font-bold" style={{ color: H }}>
          Offers &amp; negotiation{negs && negs.length > 0 ? ` (${negs.length})` : ''}
        </p>
      </div>

      {negs === null ? (
        <p className="text-xs py-4 text-center" style={{ color: SUB }}>Loading…</p>
      ) : negs.length === 0 ? (
        <div className="rounded-xl p-4 text-center" style={{ border: '1.5px dashed #EEF0F4' }}>
          <p className="text-xs" style={{ color: SUB }}>No offers logged yet.</p>
          <p className="text-xs mt-1.5 inline-flex items-center gap-1.5" style={{ color: '#1B8A4B' }}>
            <MessageCircle className="h-3.5 w-3.5" /> Log offers from the WhatsApp assistant — e.g. “offer 450k from Joe on #{propertyId}”.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {negs.map(n => {
            const st = n.state
            const style = STATUS_STYLE[st.status]
            const vs = st.currentAmount != null ? vsAsking(st.currentAmount, asking) : ''
            return (
              <div key={n.dealId} className="rounded-xl p-3" style={{ border: '1.5px solid #EEF0F4', background: '#FAFBFC' }}>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen(o => o === n.dealId ? null : n.dealId)}>
                  <p className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: H }}>{n.clientName}</p>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: style.bg, color: style.color }}>
                    {NEGOTIATION_LABEL[st.status]}
                  </span>
                </div>
                {st.currentAmount != null && (
                  <p className="text-xs mt-1" style={{ color: SUB }}>
                    <span className="font-bold" style={{ color: H }}>{money(st.currentAmount)}</span>
                    {vs ? ` · ${vs}` : ''}
                    {st.status === 'open' && st.turn ? ` · ${sideLabel(st.turn)} to respond` : ''}
                    {st.count > 1 ? ` · ${st.count} rounds` : ''}
                  </p>
                )}
                {open === n.dealId && <Thread rounds={st.rounds} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
