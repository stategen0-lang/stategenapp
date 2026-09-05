'use client'

import { useEffect, useState } from 'react'
import {
  Client, ClientType, ClientStatus, ClientReq,
  PROPERTIES, CURRENT_AGENT_ID, formatPrice, CLIENT_TAG_PRESETS, tagStyle,
  PROPERTY_TYPES, propertyTypeLabel, FURNISHINGS, FLOORS
} from '@/lib/data'
import { matchProperties, MATCH_THRESHOLD, PropertyMatch } from '@/lib/matching'
import { dbRowToProperty } from '@/lib/db-mappers'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

interface Props {
  onClose: () => void
  onSaved: (c: Client) => void
  matchThreshold?: number
  initial?: Client
}

let _nextId = 200

const emptyReq = (): ClientReq => ({
  transaction: '', type: '', location: '', locations: [], priceMin: 0, priceMax: 0,
  beds: 0, baths: 0, size: 0, garden: false, balcony: false,
  view: '', furnishing: '', floor: '', notes: '',
})

export default function NewClientModal({ onClose, onSaved, matchThreshold = MATCH_THRESHOLD, initial }: Props) {
  const editing = !!initial
  const { session } = useSession()
  const [step, setStep] = useState<1 | 2>(1)
  const [matches, setMatches] = useState<PropertyMatch[]>([])
  const [finding, setFinding] = useState(false)

  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [type, setType] = useState<ClientType>(initial?.type ?? 'Buyer')
  const [budget, setBudget] = useState<string>(initial?.budget ? String(initial.budget) : '')
  const [req, setReq] = useState<ClientReq>(initial?.req ? { ...emptyReq(), ...initial.req } : emptyReq())
  // Areas the client is open to. Seeded from the array, or an older single/joined
  // location string.
  const [locations, setLocations] = useState<string[]>(
    initial?.req?.locations?.length
      ? initial.req.locations
      : (initial?.req?.location ? initial.req.location.split(',').map(s => s.trim()).filter(Boolean) : [])
  )
  const [locationInput, setLocationInput] = useState('')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dupes, setDupes] = useState<{ id: number; name: string | null; mine: boolean }[]>([])

  // A manager (e.g. the call-center) creating a client must say which agent owns
  // it — an agent creating their own doesn't (it's always theirs). We only ask
  // when there are real agents to assign to.
  const manager = isManager(session?.role)
  const [agentOptions, setAgentOptions] = useState<{ code: string; name: string }[]>([])
  const [assignedAgent, setAssignedAgent] = useState<string>(initial?.agentId ?? '')

  // A manager who also works as an agent owns their new clients by default — the
  // dropdown starts on themselves, and they can reassign to another agent.
  useEffect(() => {
    if (!editing && manager && !assignedAgent && session?.agentCode) setAssignedAgent(session.agentCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, session?.agentCode, editing])

  useEffect(() => {
    if (!manager) return
    let alive = true
    fetch('/api/company/agents')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d?.agents) return
        const opts = Object.entries(d.agents as Record<string, { name: string }>)
          .map(([code, a]) => ({ code, name: a.name }))
          .sort((x, y) => x.name.localeCompare(y.name))
        setAgentOptions(opts)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [manager])

  const needsAgent   = manager && agentOptions.length > 0
  const agentMissing = needsAgent && !assignedAgent

  function setR(k: keyof ClientReq, v: string | number | boolean) {
    setReq(r => ({ ...r, [k]: v }))
  }

  function addLocation() {
    const v = locationInput.trim()
    if (!v) return
    setLocations(prev => prev.some(l => l.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v].slice(0, 10))
    setLocationInput('')
  }
  function removeLocation(l: string) {
    setLocations(prev => prev.filter(x => x !== l))
  }

  // Fold the pending typed location in, and mirror the areas into both the
  // display string (comma-joined) and the array used for matching.
  function reqWithLocations(): ClientReq {
    const extra = locationInput.trim()
    const all = extra && !locations.some(l => l.toLowerCase() === extra.toLowerCase())
      ? [...locations, extra] : locations
    return { ...req, location: all.join(', '), locations: all }
  }

  function toggleTag(t: string) {
    const v = t.trim().slice(0, 24)
    if (!v) return
    setTags(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v].slice(0, 12))
  }
  function addCustomTag() {
    const v = tagInput.trim()
    if (v && !tags.includes(v)) toggleTag(v)
    setTagInput('')
  }

  async function handleFindMatches() {
    if (agentMissing) { setSaveError('Please choose the responsible agent.'); return }
    setSaveError('')
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
    // Transaction is implied by client type (Buyer→For Sale, Renter→For Rent) —
    // there's no separate field to fill.
    const reqForMatch = { ...reqWithLocations(), transaction: (type === 'Renter' ? 'For Rent' : 'For Sale') as ClientReq['transaction'] }
    setMatches(matchProperties({ req: reqForMatch, budget: parseInt(budget) || 0, type }, pool, matchThreshold))
    setFinding(false)
    setStep(2)
  }

  async function handleSave(skipDupeCheck = false) {
    if (!name.trim()) { setSaveError('Client name is required.'); return }
    if (agentMissing) { setSaveError('Please choose the responsible agent.'); return }
    setSaveError('')

    // Warn about likely duplicates before creating a brand-new client (never on
    // an edit). The user can override with "Save anyway".
    if (!editing && !skipDupeCheck) {
      setSaving(true)
      try {
        const r = await fetch('/api/clients/check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone }),
        })
        if (r.ok) {
          const d = await r.json()
          if (Array.isArray(d.dupes) && d.dupes.length) { setDupes(d.dupes); setSaving(false); return }
        }
      } catch { /* if the check fails, don't block the save */ }
    }
    setDupes([])
    setSaving(true)
    // A manager picks the owning agent explicitly; an agent's own code is used
    // (the server re-stamps agents to themselves regardless).
    const agentId = manager
      ? (assignedAgent as typeof CURRENT_AGENT_ID)
      : (initial?.agentId ?? (session?.agentCode as typeof CURRENT_AGENT_ID) ?? CURRENT_AGENT_ID)
    const status: ClientStatus = initial?.status ?? 'Searching'
    const budgetNum = parseInt(budget) || 0
    const payload = {
      name, email, phone, type,
      budget: budgetNum,
      agentId,
      status,
      req: { ...reqWithLocations(), priceMin: budgetNum, priceMax: budgetNum, transaction: (type === 'Renter' ? 'For Rent' : 'For Sale') as ClientReq['transaction'] },
      tags,
    }
    let savedId = initial?.id ?? ++_nextId
    try {
      const res = await fetch('/api/clients', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: initial!.id, ...payload } : payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveError(data.error || 'Could not save. Please try again.'); setSaving(false); return }
      if (data.client?.id) savedId = data.client.id
    } catch {
      setSaveError('Network error. Please try again.'); setSaving(false); return
    }
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
                {needsAgent && (
                  <div className="col-span-2">
                    <label className={label} style={labelStyle}>Assigned agent *</label>
                    <select className={inp} style={inpStyle} value={assignedAgent} onChange={e => setAssignedAgent(e.target.value)}>
                      <option value="">Choose an agent…</option>
                      {agentOptions.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={label} style={labelStyle}>Email <span style={{ color: '#9AA3B2', fontWeight: 400 }}>(optional)</span></label>
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
                  <label className={label} style={labelStyle}>Property type</label>
                  <select className={inp} style={inpStyle} value={req.type} onChange={e => setR('type', e.target.value)}>
                    <option value="">Any</option>
                    {PROPERTY_TYPES.map(t => <option key={t} value={t}>{propertyTypeLabel(t)}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={label} style={labelStyle}>
                    Locations <span style={{ color: '#9AA3B2', fontWeight: 400 }}>(add one or more areas)</span>
                  </label>
                  {locations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {locations.map(l => (
                        <span key={l} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                          {l}
                          <button type="button" onClick={() => removeLocation(l)} style={{ color: '#2E5288' }} className="leading-none">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    className={inp}
                    style={inpStyle}
                    value={locationInput}
                    onChange={e => setLocationInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation() } }}
                    onBlur={addLocation}
                    placeholder="e.g. Achrafieh + Enter"
                  />
                </div>
                <div className="col-span-2">
                  <label className={label} style={labelStyle}>
                    Budget (USD){type === 'Renter' ? ' — monthly rent' : ''}
                  </label>
                  <input className={inp} style={inpStyle} type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder={type === 'Renter' ? '2000' : '500000'} />
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
                <div>
                  <label className={label} style={labelStyle}>View</label>
                  <input className={inp} style={inpStyle} value={req.view ?? ''} onChange={e => setR('view', e.target.value)} placeholder="Sea, Mountain…" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Furnishing</label>
                  <select className={inp} style={inpStyle} value={req.furnishing ?? ''} onChange={e => setR('furnishing', e.target.value)}>
                    <option value="">Any</option>
                    {FURNISHINGS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} style={labelStyle}>Max building age (yrs)</label>
                  <input className={inp} style={inpStyle} type="number" value={req.buildingAge || ''} onChange={e => setR('buildingAge', parseInt(e.target.value) || 0)} placeholder="e.g. 10" />
                </div>
                <div>
                  <label className={label} style={labelStyle}>Floor</label>
                  <select className={inp} style={inpStyle} value={req.floor ?? ''} onChange={e => setR('floor', e.target.value)}>
                    <option value="">Any</option>
                    {FLOORS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
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
                {type === 'Renter' && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
                    <input type="checkbox" checked={req.advancedPayment ?? false} onChange={e => setR('advancedPayment', e.target.checked)} />
                    Can pay advanced <span className="text-xs" style={{ color: '#9AA3B2' }}>(optional)</span>
                  </label>
                )}
              </div>

              <div>
                <label className={label} style={labelStyle}>Tags</label>
                {/* Quick-pick presets + any custom tags already on the client */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[...new Set([...CLIENT_TAG_PRESETS, ...tags])].map(t => {
                    const on = tags.includes(t)
                    const s = tagStyle(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                        style={on
                          ? { background: s.bg, color: s.color, boxShadow: `inset 0 0 0 1.5px ${s.color}` }
                          : { background: '#F2F4F7', color: '#9AA3B2' }}
                      >
                        {on ? '✓ ' : ''}{t}
                      </button>
                    )
                  })}
                </div>
                <input
                  className={inp}
                  style={inpStyle}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
                  onBlur={addCustomTag}
                  placeholder="Add a custom tag + Enter"
                />
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

            {saveError && <p className="px-5 pt-3 text-xs" style={{ color: '#A23434' }}>{saveError}</p>}
            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={onClose} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
                Cancel
              </button>
              {editing ? (
                <button
                  onClick={() => handleSave()}
                  disabled={!name || saving || agentMissing}
                  className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: '#0E1F3D' }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              ) : (
                <button
                  onClick={handleFindMatches}
                  disabled={!name || finding || agentMissing}
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

            {dupes.length > 0 && (
              <div className="px-5 pt-3">
                <div className="rounded-xl p-3" style={{ background: '#FBEFD6', border: '1px solid #E9CE90' }}>
                  <p className="text-xs font-bold" style={{ color: '#9A6516' }}>Possible duplicate</p>
                  <ul className="text-xs mt-1 space-y-0.5" style={{ color: '#7A5510' }}>
                    {dupes.map(d => (
                      <li key={d.id}>• {d.name ?? 'A client held by another agent'}{d.name && !d.mine ? ' (another agent)' : ''}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] mt-1.5" style={{ color: '#9A6516' }}>Save anyway if this is a different person.</p>
                </div>
              </div>
            )}
            {saveError && <p className="px-5 pt-3 text-xs" style={{ color: '#A23434' }}>{saveError}</p>}
            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={() => setStep(1)} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
                ← Back
              </button>
              <button
                onClick={() => handleSave(dupes.length > 0)}
                disabled={saving || agentMissing}
                className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: dupes.length > 0 ? '#9A6516' : '#0E1F3D' }}
              >
                {saving ? 'Saving…' : dupes.length > 0 ? 'Save anyway' : 'Save client'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
