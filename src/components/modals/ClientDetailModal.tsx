'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { Client, Agent, Property, ClientStatus, statusStyle, CLIENT_TYPE_STYLE, formatPrice, getAgent } from '@/lib/data'
import { scoreBand, BAND_STYLE } from '@/lib/scoring'
import MatchCards from '@/components/matching/MatchCards'
import PropertyDetailModal from './PropertyDetailModal'

const CLIENT_STATUSES: ClientStatus[] = ['Searching', 'Viewing', 'Negotiation', 'Signed']

interface Props {
  client: Client
  agent: Agent
  onClose: () => void
  onStatusChange?: (id: number, status: ClientStatus) => void
  onEdit?: (c: Client) => void
  /** Called after the client is transferred to another agent, so the list can refresh. */
  onReferred?: () => void
}

export default function ClientDetailModal({ client: c, agent, onClose, onStatusChange, onEdit, onReferred }: Props) {
  const [status, setStatus] = useState<ClientStatus>(c.status)
  const [saving, setSaving] = useState(false)
  const [rating, setRating] = useState<number>(c.agentRating ?? 3)
  const [leadScore, setLeadScore] = useState<number>(c.leadScore ?? 0)
  const [ratingSaving, setRatingSaving] = useState(false)
  const sc = statusStyle(status)
  const tc = CLIENT_TYPE_STYLE[c.type]
  const band = BAND_STYLE[scoreBand(leadScore)]
  const [stackedProperty, setStackedProperty] = useState<Property | null>(null)

  // Refer/transfer to another agent.
  const [referOpen, setReferOpen] = useState(false)
  const [agents, setAgents] = useState<{ code: string; name: string }[]>([])
  const [referTo, setReferTo] = useState('')
  const [referBusy, setReferBusy] = useState(false)
  const [referError, setReferError] = useState('')
  const [referDone, setReferDone] = useState('')

  async function openRefer() {
    setReferOpen(true); setReferError(''); setReferDone('')
    try {
      const r = await fetch('/api/company/agents')
      if (!r.ok) return
      const d = await r.json()
      const opts = Object.entries((d.agents ?? {}) as Record<string, { name: string }>)
        .map(([code, a]) => ({ code, name: a.name }))
        .filter(o => o.code !== c.agentId)   // not the current owner
        .sort((x, y) => x.name.localeCompare(y.name))
      setAgents(opts)
    } catch { /* leave empty; user sees "no other agents" */ }
  }

  async function handleRefer() {
    if (!referTo) { setReferError('Choose an agent to refer to.'); return }
    setReferBusy(true); setReferError('')
    try {
      const r = await fetch('/api/clients/refer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, toAgent: referTo }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setReferError(d.error || 'Could not refer this client.'); setReferBusy(false); return }
      const toName = agents.find(a => a.code === referTo)?.name || 'the agent'
      setReferDone(`Referred to ${toName}. They've been notified on WhatsApp.`)
      setReferBusy(false)
      onReferred?.()
      setTimeout(() => onClose(), 1400)
    } catch {
      setReferError('Network error. Please try again.'); setReferBusy(false)
    }
  }

  // The agent's 1-5 star gut-feel rating — 20% of the lead score. Saving it
  // recalculates the score server-side; the fresh value comes back in the reply.
  async function handleRating(stars: number) {
    const prev = rating
    setRating(stars)
    setRatingSaving(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, agent_rating: stars }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (data.client?.lead_score !== undefined) setLeadScore(Number(data.client.lead_score))
    } catch {
      setRating(prev)
    }
    setRatingSaving(false)
  }

  async function handleStatusChange(newStatus: ClientStatus) {
    setStatus(newStatus)
    setSaving(true)
    try {
      await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, status: newStatus }),
      })
      onStatusChange?.(c.id, newStatus)
    } catch {}
    setSaving(false)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
        style={{ background: 'rgba(14,31,61,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full md:max-w-md md:rounded-2xl rounded-t-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: agent.color }}>
                {c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div>
                <p className="text-base font-bold" style={{ color: '#14223F' }}>{c.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: band.bg, color: band.color }}
                    title={`Lead score ${leadScore}/100`}
                  >
                    {leadScore}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>{c.type}</span>
                  {/* Another agent's client is read-only — show the status, don't offer to change it */}
                  {c.masked ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{status}</span>
                  ) : (
                    <select
                      value={status}
                      disabled={saving}
                      onChange={e => handleStatusChange(e.target.value as ClientStatus)}
                      className="text-xs font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer appearance-none"
                      style={{ background: sc.bg, color: sc.color, opacity: saving ? 0.6 : 1 }}
                    >
                      {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!c.masked && (
                <button
                  onClick={() => (referOpen ? setReferOpen(false) : openRefer())}
                  className="h-7 px-3 rounded-full text-xs font-semibold"
                  style={{ background: '#E7F3EC', color: '#1F7A4D' }}
                >
                  Refer
                </button>
              )}
              {onEdit && (
                <button
                  onClick={() => onEdit(c)}
                  className="h-7 px-3 rounded-full text-xs font-semibold"
                  style={{ background: '#EAF0FA', color: '#2E5288' }}
                >
                  Edit
                </button>
              )}
              <button onClick={onClose} style={{ color: '#9AA3B2' }} className="hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto max-h-[80vh] md:max-h-[70vh]">
            {/* Refer / transfer panel */}
            {referOpen && (
              <div className="rounded-xl p-4" style={{ background: '#F1F8F3', border: '1px solid #CDE7D6' }}>
                <p className="text-xs font-bold mb-1" style={{ color: '#1F7A4D' }}>Refer this client to another agent</p>
                <p className="text-xs mb-2.5" style={{ color: '#6A7488' }}>
                  Ownership moves to them; you stay recorded as the referrer for commission, and they&apos;re notified on WhatsApp.
                </p>
                {referDone ? (
                  <p className="text-sm font-semibold" style={{ color: '#1F7A4D' }}>✓ {referDone}</p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <select
                        value={referTo}
                        onChange={e => setReferTo(e.target.value)}
                        className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                        style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#14223F' }}
                      >
                        <option value="">Choose an agent…</option>
                        {agents.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                      </select>
                      <button
                        onClick={handleRefer}
                        disabled={referBusy || !referTo}
                        className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        style={{ background: '#1F7A4D' }}
                      >
                        {referBusy ? 'Referring…' : 'Refer'}
                      </button>
                    </div>
                    {agents.length === 0 && <p className="text-xs mt-2" style={{ color: '#9AA3B2' }}>No other agents to refer to.</p>}
                    {referError && <p className="text-xs mt-2" style={{ color: '#A23434' }}>{referError}</p>}
                  </>
                )}
              </div>
            )}

            {/* Referred-by badge */}
            {c.referredByName && (
              <p className="text-xs" style={{ color: '#6A7488' }}>
                Referred by <span style={{ fontWeight: 700, color: '#14223F' }}>{c.referredByName}</span> · they receive the referral commission
              </p>
            )}

            {/* Contact info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>Email</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: '#14223F' }}>{c.email}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>Phone</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: '#14223F' }}>{c.phone}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>Budget</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: '#14223F' }}>{formatPrice(c.budget)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>Agent</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: '#14223F' }}>{agent.name}</p>
              </div>
            </div>

            {/* Agent rating — 1-5 stars, feeds 20% of the lead score.
                Only the owning agent (or a manager) may set it. */}
            {c.masked ? (
              <div className="rounded-xl px-4 py-3" style={{ background: '#F7F8FB' }}>
                <p className="text-xs font-bold" style={{ color: '#14223F' }}>ANOTHER AGENT&apos;S CLIENT</p>
                <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>
                  Contact details are hidden and this record is read-only.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: '#F7F8FB' }}>
                <div>
                  <p className="text-xs font-bold" style={{ color: '#14223F' }}>AGENT RATING</p>
                  <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>Your gut feel — feeds the lead score</p>
                </div>
                <div className="flex items-center gap-1" style={{ opacity: ratingSaving ? 0.5 : 1 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <button
                      key={s}
                      onClick={() => !ratingSaving && handleRating(s)}
                      className="p-0.5 transition-transform hover:scale-110"
                      aria-label={`${s} star${s > 1 ? 's' : ''}`}
                    >
                      <Star
                        className="h-5 w-5"
                        style={{ color: s <= rating ? '#E8A93C' : '#D7DCE5' }}
                        fill={s <= rating ? '#E8A93C' : 'none'}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Requirements */}
            <div className="rounded-xl p-4" style={{ background: '#F7F8FB' }}>
              <p className="text-xs font-bold mb-3" style={{ color: '#14223F' }}>REQUIREMENTS</p>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                {[
                  { label: 'Transaction', value: c.req.transaction || '—' },
                  { label: 'Type',        value: c.req.type || '—' },
                  { label: 'Location',    value: c.req.location || '—' },
                  { label: 'Budget',      value: c.budget ? formatPrice(c.budget) : '—' },
                  { label: 'Bedrooms',    value: c.req.beds ? String(c.req.beds) : '—' },
                  { label: 'Bathrooms',   value: c.req.baths ? String(c.req.baths) : '—' },
                  { label: 'Min Size',    value: c.req.size ? `${c.req.size} m²` : '—' },
                  ...(c.req.view ? [{ label: 'View', value: c.req.view }] : []),
                  ...(c.req.furnishing ? [{ label: 'Furnishing', value: c.req.furnishing }] : []),
                  ...(c.req.buildingAge ? [{ label: 'Max age', value: `${c.req.buildingAge} yrs` }] : []),
                  ...(c.req.floor ? [{ label: 'Floor', value: c.req.floor }] : []),
                  { label: 'Garden',      value: c.req.garden  ? 'Required' : 'No pref' },
                  { label: 'Balcony',     value: c.req.balcony ? 'Required' : 'No pref' },
                  ...(c.req.transaction === 'For Rent' || c.type === 'Renter'
                    ? [{ label: 'Advanced pay', value: c.req.advancedPayment ? 'Can pay' : 'Cannot pay' }]
                    : []),
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span style={{ color: '#9AA3B2' }}>{label}: </span>
                    <span style={{ color: '#14223F', fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            {c.req.notes && (
              <div>
                <p className="text-xs font-bold mb-1" style={{ color: '#9AA3B2' }}>NOTES</p>
                <p className="text-sm leading-relaxed" style={{ color: '#6A7488' }}>{c.req.notes}</p>
              </div>
            )}

            {/* ── AI Matching ── */}
            <div style={{ borderTop: '1px solid #EEF0F4', paddingTop: 16 }}>
              <MatchCards
                entityType="client"
                entity={c}
                onOpenProperty={p => setStackedProperty(p)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stacked property modal — comes later in DOM so renders above at same z-index */}
      {stackedProperty && (
        <PropertyDetailModal
          property={stackedProperty}
          agent={getAgent(stackedProperty.agentId)}
          onClose={() => setStackedProperty(null)}
        />
      )}
    </>
  )
}
