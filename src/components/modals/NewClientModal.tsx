'use client'

import { useState } from 'react'
import {
  Client, ClientType, ClientStatus, ClientReq, PropertyType,
  PROPERTIES, CURRENT_AGENT_ID, formatPrice
} from '@/lib/data'
import { matchProperties, MATCH_THRESHOLD, PropertyMatch } from '@/lib/matching'
import { dbRowToProperty } from '@/lib/db-mappers'

const PROPERTY_TYPES: PropertyType[] = ['Appartement', 'Shop', 'Office', 'Building', 'Villa', 'Land', 'Showroom', 'Restaurant']

interface Props {
  onClose: () => void
  onSaved: (c: Client) => void
  matchThreshold?: number
  initial?: Client
}

let _nextId = 200

const emptyReq = (): ClientReq => ({
  transaction: '', type: '', location: '', priceMin: 0, priceMax: 0,
  beds: 0, baths: 0, size: 0, garden: false, balcony: false, notes: '',
})

export default function NewClientModal({ onClose, onSaved, matchThreshold = MATCH_THRESHOLD, initial }: Props) {
  const editing = !!initial
  const [step, setStep] = useState<1 | 2>(1)
  const [matches, setMatches] = useState<PropertyMatch[]>([])
  const [finding, setFinding] = useState(false)

  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [type, setType] = useState<ClientType>(initial?.type ?? 'Buyer')
  const [req, setReq] = useState<ClientReq>(initial?.req ? { ...emptyReq(), ...initial.req } : emptyReq())

  function setR(k: keyof ClientReq, v: string | number | boolean) {
    setReq(r => ({ ...r, [k]: v }))
  }

  async function handleFindMatches() {
    setFinding(true)
    // Match against the agency's real listings (demo data as offline fallback).
    let pool = PROPERTIES
    try {
      const res = await fetch('/api/properties')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.properties)) pool = data.properties.map(dbRowToProperty)
      }
    } catch { /* keep demo fallback */ }
    setMatches(matchProperties({ req, budget: req.priceMax || 0, type }, pool, matchThreshold))
    setFinding(false)
    setStep(2)
  }

  async function handleSave() {
    const agentId = initial?.agentId ?? CURRENT_AGENT_ID
    const status: ClientStatus = initial?.status ?? 'Searching'
    const payload = {
      name, email, phone, type,
      budget: req.priceMax || 0,
      agentId,
      status,
      req,
    }
    let savedId = initial?.id ?? ++_nextId
    try {
      const res = await fetch('/api/clients', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: initial!.id, ...payload } : payload),
      })
      const data = await res.json()
      if (data.client?.id) savedId = data.client.id
    } catch {}
    const c: Client = { id: savedId, ...payload, agentId, status }
    onSaved(c)
  }

  const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none'
  const inpStyle = { border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: '#14223F' }
  const label = 'text-xs font-semibold mb-1 block'
  const labelStyle = { color: '#6A7488' }

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
            <p className="text-base font-bold" style={{ color: '#14223F' }}>
              {step === 2 ? 'Match Results' : editing ? 'Edit Client' : 'New Client'}
            </p>
            {!editing && <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>Step {step} of 2</p>}
          </div>
          <button onClick={onClose} style={{ color: '#9AA3B2' }} className="hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {step === 1 ? (
          <>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={label} style={labelStyle}>Name *</label>
                  <input className={inp} style={inpStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Email</label>
                  <input className={inp} style={inpStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Phone</label>
                  <input className={inp} style={inpStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+961 3…" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Client type</label>
                  <select className={inp} style={inpStyle} value={type} onChange={e => setType(e.target.value as ClientType)}>
                    {(['Buyer','Renter'] as ClientType[]).map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} style={labelStyle}>Transaction</label>
                  <select className={inp} style={inpStyle} value={req.transaction} onChange={e => setR('transaction', e.target.value)}>
                    <option value="">Any</option>
                    <option>For Sale</option>
                    <option>For Rent</option>
                  </select>
                </div>
                <div>
                  <label className={label} style={labelStyle}>Property type</label>
                  <select className={inp} style={inpStyle} value={req.type} onChange={e => setR('type', e.target.value)}>
                    <option value="">Any</option>
                    {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} style={labelStyle}>Location</label>
                  <input className={inp} style={inpStyle} value={req.location} onChange={e => setR('location', e.target.value)} placeholder="Beirut, Metn…" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Min price</label>
                  <input className={inp} style={inpStyle} type="number" value={req.priceMin || ''} onChange={e => setR('priceMin', parseInt(e.target.value) || 0)} placeholder="400000" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Max price</label>
                  <input className={inp} style={inpStyle} type="number" value={req.priceMax || ''} onChange={e => setR('priceMax', parseInt(e.target.value) || 0)} placeholder="700000" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Beds</label>
                  <input className={inp} style={inpStyle} type="number" value={req.beds || ''} onChange={e => setR('beds', parseInt(e.target.value) || 0)} placeholder="3" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Baths</label>
                  <input className={inp} style={inpStyle} type="number" value={req.baths || ''} onChange={e => setR('baths', parseInt(e.target.value) || 0)} placeholder="2" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Min size (m²)</label>
                  <input className={inp} style={inpStyle} type="number" value={req.size || ''} onChange={e => setR('size', parseInt(e.target.value) || 0)} placeholder="100" />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
                  <input type="checkbox" checked={req.garden} onChange={e => setR('garden', e.target.checked)} />
                  Garden required
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
                  <input type="checkbox" checked={req.balcony} onChange={e => setR('balcony', e.target.checked)} />
                  Balcony required
                </label>
                {(req.transaction === 'For Rent' || type === 'Renter') && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
                    <input type="checkbox" checked={req.advancedPayment ?? false} onChange={e => setR('advancedPayment', e.target.checked)} />
                    Can pay advanced <span className="text-xs" style={{ color: '#9AA3B2' }}>(optional)</span>
                  </label>
                )}
              </div>

              <div>
                <label className={label} style={labelStyle}>Notes</label>
                <textarea
                  className={inp}
                  style={{ ...inpStyle, resize: 'none' }}
                  rows={2}
                  value={req.notes}
                  onChange={e => setR('notes', e.target.value)}
                  placeholder="Additional requirements…"
                />
              </div>
            </div>

            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={onClose} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
                Cancel
              </button>
              {editing ? (
                <button
                  onClick={handleSave}
                  disabled={!name}
                  className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: '#0E1F3D' }}
                >
                  Save changes
                </button>
              ) : (
                <button
                  onClick={handleFindMatches}
                  disabled={!name || finding}
                  className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: '#0E1F3D' }}
                >
                  {finding ? 'Finding…' : 'Find matches →'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              {matches.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm font-semibold" style={{ color: '#14223F' }}>No matches found</p>
                  <p className="text-xs mt-1" style={{ color: '#9AA3B2' }}>
                    No properties ≥{matchThreshold}% match the requirements.
                  </p>
                </div>
              ) : (
                matches.map(({ property: p, score: s }) => {
                  const pct = Math.round(s.total)
                  const ringColor = pct >= 75 ? '#1F8A5B' : '#9A6516'
                  const circumference = 2 * Math.PI * 16
                  const dash = (pct / 100) * circumference
                  const subs = [
                    { label: 'Budget',   v: s.budgetScore },
                    { label: 'Location', v: s.locationScore },
                    { label: 'Type',     v: s.typeScore },
                    { label: 'Beds',     v: s.bedroomScore },
                  ]
                  return (
                    <div key={p.id} className="rounded-xl p-4" style={{ border: '1.5px solid #EEF0F4', background: '#FAFBFC' }}>
                      <div className="flex items-start gap-3 mb-3">
                        {/* Ring gauge */}
                        <div className="shrink-0">
                          <svg width="44" height="44" viewBox="0 0 44 44">
                            <circle cx="22" cy="22" r="16" fill="none" strokeWidth="4" stroke="#EEF0F4" />
                            <circle
                              cx="22" cy="22" r="16" fill="none" strokeWidth="4"
                              stroke={ringColor}
                              strokeDasharray={`${dash} ${circumference - dash}`}
                              strokeLinecap="round"
                              transform="rotate(-90 22 22)"
                            />
                            <text x="22" y="26" textAnchor="middle" fontSize="9" fontWeight="700" fill={ringColor}>{pct}%</text>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold" style={{ color: '#14223F' }}>{p.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>
                            {p.district}, {p.city} ·{' '}
                            {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
                          </p>
                        </div>
                      </div>
                      {/* Sub-score chips */}
                      <div className="flex flex-wrap gap-1">
                        {subs.map(({ label, v }) => (
                          <span
                            key={label}
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={v >= 75
                              ? { background: '#E3F4EA', color: '#1F7A4D' }
                              : v >= 50
                                ? { background: '#FBEFD6', color: '#9A6516' }
                                : { background: '#FBE7E7', color: '#A23434' }}
                          >
                            {label} {Math.round(v)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={() => setStep(1)} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
                ← Back
              </button>
              <button
                onClick={handleSave}
                className="flex-1 rounded-xl py-2 text-sm font-bold text-white"
                style={{ background: '#0E1F3D' }}
              >
                Save client
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
