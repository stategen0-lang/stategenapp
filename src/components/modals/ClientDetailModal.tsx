'use client'

import { useState, useRef } from 'react'
import { Star, FileText, Upload, X, Loader2, ExternalLink } from 'lucide-react'
import { Client, Agent, Property, ClientStatus, ClosingDocument, statusStyle, CLIENT_TYPE_STYLE, CLOSING_DOC_PRESETS, CLOSING_ID_PARTS, formatPrice, getAgent } from '@/lib/data'
import { closingProgress } from '@/lib/pipeline'
import { scoreBand, BAND_STYLE } from '@/lib/scoring'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { usePullToClose } from '@/hooks/use-pull-to-close'
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
  useLockBodyScroll()
  // Pull down at the top of the sheet to go back to the list — the mobile
  // gesture equivalent of tapping ✕.
  const { scrollRef: pullScrollRef, panelRef: pullPanelRef, pulling, progress } = usePullToClose(onClose)
  const [status, setStatus] = useState<ClientStatus>(c.status)
  const [statusError, setStatusError] = useState('')
  const [rating, setRating] = useState<number>(c.agentRating ?? 3)
  const [leadScore, setLeadScore] = useState<number>(c.leadScore ?? 0)
  const [ratingSaving, setRatingSaving] = useState(false)
  const sc = statusStyle(status)
  const tc = CLIENT_TYPE_STYLE[c.type]
  const band = BAND_STYLE[scoreBand(leadScore)]
  const [stackedProperty, setStackedProperty] = useState<Property | null>(null)

  // Closing checklist — down payment + paperwork (ID, proof of down payment,
  // signed contract, …). Lightweight for now: stored in the client's notes
  // JSON, files in the existing private document bucket.
  const [downPayment, setDownPayment] = useState<string>(c.closing?.downPayment != null ? String(c.closing.downPayment) : '')
  // Not every deal has a down payment — a seller may want full payment, or
  // it's a rental with none required. Explicit, not just "left blank", so the
  // checklist can tell "not filled in yet" from "not applicable".
  const [downPaymentWaived, setDownPaymentWaived] = useState<boolean>(c.closing?.downPaymentWaived === true)
  const [closingDocs, setClosingDocs] = useState<ClosingDocument[]>(c.closing?.documents ?? [])
  const [docLabel, setDocLabel] = useState<string>(CLOSING_DOC_PRESETS[0])
  // Which page/side, only asked when the label is "ID Copy" (front/back, or a
  // passport's page(s)) — an ID or passport often needs more than one file.
  const [idPart, setIdPart] = useState<string>(CLOSING_ID_PARTS[0])
  const [docUploading, setDocUploading] = useState(false)
  const [docError, setDocError] = useState('')
  const [closingSaving, setClosingSaving] = useState(false)
  const [closingCelebrate, setClosingCelebrate] = useState(false)
  const closingInputRef = useRef<HTMLInputElement>(null)

  async function saveClosing(nextDocs: ClosingDocument[], nextDownPayment: string, nextWaived: boolean) {
    setClosingSaving(true)
    try {
      const dp = !nextWaived && nextDownPayment.trim() ? Number(nextDownPayment) : undefined
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, closing: { downPayment: dp, downPaymentWaived: nextWaived, documents: nextDocs } }),
      })
      const data = await res.json().catch(() => ({}))
      // Full checklist just came together — the server already moved the deal
      // to Closed/Won; reflect the client status locally so the modal doesn't
      // wait for a reload to show it.
      if (data?.closingJustCompleted) {
        setStatus('Signed')
        onStatusChange?.(c.id, 'Signed')
        setClosingCelebrate(true)
      }
    } catch { /* best-effort; the file itself is already uploaded */ }
    setClosingSaving(false)
  }

  function handleDownPaymentBlur() {
    saveClosing(closingDocs, downPayment, downPaymentWaived)
  }

  function toggleDownPaymentWaived() {
    const next = !downPaymentWaived
    setDownPaymentWaived(next)
    if (next) {
      setDownPayment('')
      if (docLabel === 'Down Payment Proof') setDocLabel(CLOSING_DOC_PRESETS[0])
    }
    saveClosing(closingDocs, next ? '' : downPayment, next)
  }

  async function handleClosingFile(file: File | undefined) {
    if (!file) return
    setDocError('')
    setDocUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload/document', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setDocError(data.error || 'Could not upload that file.'); return }
      const doc: ClosingDocument = {
        label: docLabel,
        ...(docLabel === CLOSING_DOC_PRESETS[0] ? { part: idPart } : {}),
        path: data.path, name: data.name || file.name, uploadedAt: new Date().toISOString(),
      }
      const next = [...closingDocs, doc]
      setClosingDocs(next)
      saveClosing(next, downPayment, downPaymentWaived)
    } catch {
      setDocError('Network error. Try again.')
    } finally {
      setDocUploading(false)
      if (closingInputRef.current) closingInputRef.current.value = ''
    }
  }

  function removeClosingDoc(path: string) {
    const next = closingDocs.filter(d => d.path !== path)
    setClosingDocs(next)
    saveClosing(next, downPayment, downPaymentWaived)
  }

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
    // Show it everywhere at once, then save. A failed save used to leave the new
    // status on screen for good (the error was swallowed) — now it goes back.
    const previous = status
    setStatus(newStatus)
    setStatusError('')
    onStatusChange?.(c.id, newStatus)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, status: newStatus }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setStatus(previous)
      onStatusChange?.(c.id, previous)
      setStatusError('Could not change the status — try again')
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
        style={{ background: 'rgba(14,31,61,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div ref={pullPanelRef} className="w-full md:max-w-md md:rounded-2xl rounded-t-2xl overflow-hidden relative" style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
          {/* Pull-to-close hint — fades in as the sheet is dragged down, only relevant on mobile */}
          <div
            className="md:hidden absolute left-0 right-0 flex justify-center pointer-events-none z-10"
            style={{ top: 8, opacity: pulling ? progress : 0, transition: pulling ? 'none' : 'opacity 0.2s ease' }}
          >
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(14,31,61,0.85)', color: '#fff' }}>
              {progress >= 1 ? 'Release to go back' : '↓ Pull to go back'}
            </span>
          </div>
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
                      onChange={e => handleStatusChange(e.target.value as ClientStatus)}
                      className="text-xs font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer appearance-none"
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                {statusError && <p className="text-xs mt-1" style={{ color: '#A23434' }}>{statusError}</p>}
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

          <div ref={pullScrollRef} className="p-5 space-y-4 overflow-y-auto max-h-[80vh] md:max-h-[70vh]" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
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

            {/* Closing checklist — down payment + paperwork. Hidden for another
                agent's masked client, same as the rating. */}
            {!c.masked && (
              <div className="rounded-xl p-4" style={{ background: '#F7F8FB' }}>
                {closingCelebrate && (
                  <div className="rounded-lg px-3 py-2 mb-3 text-xs font-semibold" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>
                    🎉 Checklist complete — this deal moved to Closed · Won and the client is marked Signed.
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold" style={{ color: '#14223F' }}>CLOSING CHECKLIST</p>
                    {(() => {
                      const p = closingProgress({
                        downPayment: downPayment.trim() ? Number(downPayment) : undefined,
                        downPaymentWaived,
                        docLabels: closingDocs.map(d => d.label),
                      })
                      return (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={p.complete ? { background: '#E3F4EA', color: '#1F7A4D' } : { background: '#EAF0FA', color: '#2E5288' }}>
                          {p.have}/{p.total} docs{p.complete ? ' · down payment settled' : ''}
                        </span>
                      )
                    })()}
                  </div>
                  {closingSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#9AA3B2' }} />}
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs" style={{ color: '#9AA3B2' }}>Down payment</p>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#6A7488' }}>
                      <input type="checkbox" checked={downPaymentWaived} onChange={toggleDownPaymentWaived} className="cursor-pointer" />
                      No down payment required
                    </label>
                  </div>
                  <input
                    type="number"
                    min={0}
                    disabled={downPaymentWaived}
                    value={downPaymentWaived ? '' : downPayment}
                    onChange={e => setDownPayment(e.target.value)}
                    onBlur={handleDownPaymentBlur}
                    placeholder={downPaymentWaived ? 'Not required' : 'e.g. 50000'}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-60"
                    style={{ border: '1.5px solid #EEF0F4', background: downPaymentWaived ? '#F0F2F5' : '#fff', color: '#14223F' }}
                  />
                </div>

                {closingDocs.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {closingDocs.map(doc => (
                      <div key={doc.path} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: '#fff', border: '1.5px solid #EEF0F4' }}>
                        <FileText className="h-4 w-4 shrink-0" style={{ color: '#5E8FD6' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: '#14223F' }}>{doc.label}{doc.part ? ` — ${doc.part}` : ''}</p>
                          <p className="text-[11px] truncate" style={{ color: '#9AA3B2' }}>{doc.name}</p>
                        </div>
                        <a href={`/api/clients/document?id=${c.id}&path=${encodeURIComponent(doc.path)}`} target="_blank" rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-gray-100" title="Open">
                          <ExternalLink className="h-3.5 w-3.5" style={{ color: '#6A7488' }} />
                        </a>
                        <button type="button" onClick={() => removeClosingDoc(doc.path)} className="p-1 rounded hover:bg-gray-100" title="Remove">
                          <X className="h-3.5 w-3.5" style={{ color: '#A23434' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={docLabel}
                    onChange={e => setDocLabel(e.target.value)}
                    className="rounded-lg px-2.5 py-2 text-xs outline-none"
                    style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#14223F' }}
                  >
                    {CLOSING_DOC_PRESETS.filter(p => !(downPaymentWaived && p === 'Down Payment Proof')).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {/* An ID/passport is rarely one file — front+back, or a
                      passport's photo page(s). Ask which page this upload is. */}
                  {docLabel === CLOSING_DOC_PRESETS[0] && (
                    <select
                      value={idPart}
                      onChange={e => setIdPart(e.target.value)}
                      className="rounded-lg px-2.5 py-2 text-xs outline-none"
                      style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#14223F' }}
                    >
                      {CLOSING_ID_PARTS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => closingInputRef.current?.click()}
                    disabled={docUploading}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
                    style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#0E1F3D' }}
                  >
                    {docUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {docUploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <input
                    ref={closingInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,image/*"
                    className="hidden"
                    onChange={e => handleClosingFile(e.target.files?.[0])}
                  />
                </div>
                {docLabel === CLOSING_DOC_PRESETS[0] && (
                  <p className="text-[11px] mt-1.5" style={{ color: '#9AA3B2' }}>
                    Upload front and back separately — pick the page above before each upload. One page is enough to count as complete.
                  </p>
                )}
                {docError && <p className="text-xs mt-2" style={{ color: '#A23434' }}>{docError}</p>}
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
                  ...((c.req.parkings ?? 0) > 0 ? [{ label: 'Parking', value: String(c.req.parkings) }] : []),
                  { label: 'Garden',      value: c.req.garden  ? 'Required' : 'No pref' },
                  { label: 'Balcony',     value: c.req.balcony ? 'Required' : 'No pref' },
                  ...(c.req.terrace ? [{ label: 'Terrace', value: 'Required' }] : []),
                  ...([...(c.req.amenities ?? []), ...(c.req.buildingFeatures ?? [])].length
                    ? [{ label: 'Must have', value: [...(c.req.amenities ?? []), ...(c.req.buildingFeatures ?? [])].join(', ') }]
                    : []),
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
          agent={getAgent(stackedProperty.agentId) ?? { id: stackedProperty.agentId as Agent['id'], name: stackedProperty.agentId, initials: stackedProperty.agentId.slice(0,2).toUpperCase(), color: '#9AA3B2', shortName: stackedProperty.agentId }}
          onClose={() => setStackedProperty(null)}
        />
      )}
    </>
  )
}
