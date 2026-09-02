'use client'

import { useState, useEffect, useRef } from 'react'
import { Building2, Lock, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, User, Calendar, Plus, X } from 'lucide-react'
import { PLANS } from '@/lib/stripe-plans'

const ADMIN_PIN = 'sg2026'

const QUICK = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
]

function addDays(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Agent {
  id: string
  Full_name: string
  role: string
  agent_code: string | null
  approved: boolean
  created_at: string
}

interface Company {
  id: number
  Name: string
  domain: string
  Plan: string
  'is active': boolean
  access_status: string
  access_until: string | null
  created_at: string
}

interface Invoice {
  id: string
  number: string | null
  plan: string | null
  subtotal: number | null
  discount_pct: number | null
  amount: number
  currency: string
  period_start: string | null
  period_end: string | null
  status: string
  method: string | null
  note: string | null
  created_at: string
  paid_at: string | null
}

export default function AdminPage() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Activation picker state
  const [activating, setActivating] = useState<number | null>(null)   // company id being activated
  const [untilDate, setUntilDate] = useState('')
  const [saving, setSaving] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Create-company modal
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ companyName: '', domain: '', email: '', password: '', planId: 'team', activate: true })
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')

  async function createCompany() {
    setCreateBusy(true); setCreateErr('')
    try {
      const r = await fetch('/api/admin/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, accessDays: form.activate ? 30 : 0 }),
      })
      const j = await r.json()
      if (!r.ok) { setCreateErr(j.error || 'Could not create the company.'); setCreateBusy(false); return }
      setCompanies(prev => [j.company, ...prev])
      setCreateOpen(false)
      setForm({ companyName: '', domain: '', email: '', password: '', planId: 'team', activate: true })
    } catch { setCreateErr('Could not create the company.') }
    setCreateBusy(false)
  }

  // ── Invoices (per company) ──────────────────────────────────────────────────
  const [invoicesFor, setInvoicesFor] = useState<Company | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invLoading, setInvLoading] = useState(false)
  const [invForm, setInvForm] = useState({ planId: 'team', subtotal: '', discountPct: '', months: '1', method: '', note: '' })
  const [invBusy, setInvBusy] = useState(false)
  const [invErr, setInvErr] = useState('')

  async function openInvoices(company: Company) {
    setInvoicesFor(company); setInvoices([]); setInvErr('')
    const plan = PLANS.find(p => p.id === company.Plan) ?? PLANS[0]
    setInvForm({ planId: plan.id, subtotal: String(plan.price), discountPct: '', months: '1', method: '', note: '' })
    setInvLoading(true)
    const r = await fetch(`/api/admin/invoices?companyId=${company.id}`).then(x => x.ok ? x.json() : null).catch(() => null)
    setInvoices(r?.invoices ?? [])
    setInvLoading(false)
  }
  // subtotal field = price per month; the period length multiplies it.
  function invMonths() { return Math.max(1, Number(invForm.months) || 1) }
  function invTotal() {
    const sub = (Number(invForm.subtotal) || 0) * invMonths()
    const disc = Math.min(100, Math.max(0, Number(invForm.discountPct) || 0))
    return Math.round(sub * (1 - disc / 100) * 100) / 100
  }
  async function createInvoice() {
    if (!invoicesFor) return
    setInvBusy(true); setInvErr('')
    try {
      const months = invMonths()
      const start = new Date()
      const end = new Date(start); end.setMonth(end.getMonth() + months)
      const r = await fetch('/api/admin/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: invoicesFor.id, plan: invForm.planId,
          // Send the full-period pre-discount subtotal (price/month × months).
          subtotal: (Number(invForm.subtotal) || 0) * months,
          discount_pct: Number(invForm.discountPct) || 0,
          period_start: start.toISOString().slice(0, 10),
          period_end: end.toISOString().slice(0, 10),
          method: invForm.method || null, note: invForm.note || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setInvErr(j.error || 'Could not create the invoice.'); return }
      setInvoices(prev => [j.invoice, ...prev])
    } finally { setInvBusy(false) }
  }
  async function setInvoiceStatus(id: string, status: 'paid' | 'void') {
    const r = await fetch('/api/admin/invoices', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    if (r.ok) {
      setInvoices(prev => prev.map(iv => iv.id === id ? { ...iv, status, paid_at: status === 'paid' ? new Date().toISOString() : null } : iv))
      // Paying activates the company through the invoice's period end — reflect
      // that in the company row without a full reload.
      if (status === 'paid' && invoicesFor) {
        const iv = invoices.find(x => x.id === id)
        if (iv?.period_end) {
          setCompanies(prev => prev.map(co => co.id === invoicesFor.id
            ? { ...co, 'is active': true, access_status: 'active', access_until: new Date(iv.period_end as string).toISOString() }
            : co))
        }
      }
    }
  }
  function printInvoice(inv: Invoice) {
    const c = invoicesFor
    const w = window.open('', '_blank', 'width=820,height=940')
    if (!w) return
    const money = (n: number) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const sub = inv.subtotal ?? inv.amount
    const disc = inv.discount_pct ?? 0
    const esc = (s: string) => String(s ?? '').replace(/[<>&]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string))
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number ?? 'Invoice')}</title>
      <style>body{font-family:-apple-system,Segoe UI,sans-serif;color:#14223F;max-width:640px;margin:40px auto;padding:0 24px}
      h1{font-size:22px;margin:0}.muted{color:#7A8499}.row{display:flex;justify-content:space-between;padding:6px 0}
      table{width:100%;border-collapse:collapse;margin-top:24px}td,th{text-align:left;padding:10px 0;border-bottom:1px solid #EEF0F4}
      .r{text-align:right}.tot{font-size:18px;font-weight:800}.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700}</style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h1>StateGen</h1><p class="muted" style="margin:4px 0 0">Real estate CRM</p></div>
        <div style="text-align:right"><p style="margin:0;font-weight:800">${esc(inv.number ?? '')}</p>
        <p class="muted" style="margin:4px 0 0">${new Date(inv.created_at).toLocaleDateString()}</p>
        <span class="badge" style="background:${inv.status === 'paid' ? '#E3F4EA' : inv.status === 'void' ? '#F1F1F1' : '#FBEFD6'};color:${inv.status === 'paid' ? '#1F7A4D' : inv.status === 'void' ? '#777' : '#9A6516'}">${inv.status.toUpperCase()}</span></div>
      </div>
      <div style="margin-top:24px"><p class="muted" style="margin:0">Billed to</p><p style="margin:4px 0 0;font-weight:700">${esc(c?.Name ?? '')}</p><p class="muted" style="margin:2px 0 0">${esc(c?.domain ?? '')}</p></div>
      <table><tr><th>Description</th><th class="r">Amount</th></tr>
        <tr><td>${esc((inv.plan ?? '').charAt(0).toUpperCase() + (inv.plan ?? '').slice(1))} plan${inv.period_start && inv.period_end ? ` · ${inv.period_start} → ${inv.period_end}` : ''}</td><td class="r">${money(sub)}</td></tr>
        ${disc > 0 ? `<tr><td>Discount (${disc}%)</td><td class="r" style="color:#1F7A4D">-${money(sub - inv.amount)}</td></tr>` : ''}
        <tr><td class="tot">Total due</td><td class="r tot">${money(inv.amount)}</td></tr></table>
      ${inv.note ? `<p class="muted" style="margin-top:20px">${esc(inv.note)}</p>` : ''}
      ${inv.method ? `<p class="muted" style="margin-top:8px">Payment method: ${esc(inv.method)}</p>` : ''}
      <p class="muted" style="margin-top:40px;font-size:12px">Thank you.</p>
      </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250)
  }

  // Per-company agent list
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [agentsMap, setAgentsMap] = useState<Record<number, Agent[]>>({})
  const [agentsLoading, setAgentsLoading] = useState<number | null>(null)
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null)

  // Close picker on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setActivating(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handlePin(e: React.FormEvent) {
    e.preventDefault()
    if (pin === ADMIN_PIN) { setUnlocked(true); setPinError(false) }
    else setPinError(true)
  }

  useEffect(() => {
    if (!unlocked) return
    setLoading(true)
    setLoadError(null)
    fetch('/api/admin/companies')
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          // The panel is operator-only. A 401/403 here means the signed-in
          // account isn't a StateGen operator — say so instead of a blank list.
          setLoadError(
            r.status === 401 || r.status === 403
              ? 'Not signed in as a StateGen operator. Sign in with the operator account (stategen0@gmail.com) in this same browser, then reopen /admin.'
              : (data.error || 'Could not load companies.'),
          )
          return
        }
        setCompanies(data.companies ?? [])
      })
      .catch(() => setLoadError('Could not reach the server. Check your connection and try again.'))
      .finally(() => setLoading(false))
  }, [unlocked])

  function openActivatePicker(company: Company) {
    // Pre-fill: extend from current access_until if still in future, otherwise from today
    const base = company.access_until && new Date(company.access_until) > new Date()
      ? new Date(company.access_until)
      : new Date()
    const def = new Date(base)
    def.setDate(def.getDate() + 30)
    setUntilDate(def.toISOString().slice(0, 10))
    setActivating(company.id)
  }

  async function confirmActivate(company: Company) {
    setSaving(true)
    try {
      await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, active: true, access_until: untilDate }),
      })
      setCompanies(prev => prev.map(c =>
        c.id === company.id
          ? { ...c, 'is active': true, access_status: 'active', access_until: untilDate }
          : c
      ))
      setActivating(null)
    } catch {}
    setSaving(false)
  }

  async function deactivate(company: Company) {
    try {
      await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, active: false }),
      })
      setCompanies(prev => prev.map(c =>
        c.id === company.id ? { ...c, 'is active': false, access_status: 'pending' } : c
      ))
    } catch {}
  }

  async function expandCompany(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (agentsMap[id]) return
    setAgentsLoading(id)
    try {
      const r = await fetch(`/api/admin/agents?companyId=${id}`)
      const data = await r.json()
      setAgentsMap(prev => ({ ...prev, [id]: data.agents ?? [] }))
    } catch {}
    setAgentsLoading(null)
  }

  async function toggleAgent(companyId: number, agent: Agent) {
    setTogglingAgent(agent.id)
    const newApproved = !agent.approved
    try {
      await fetch('/api/admin/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, approved: newApproved }),
      })
      setAgentsMap(prev => ({
        ...prev,
        [companyId]: (prev[companyId] ?? []).map(a =>
          a.id === agent.id ? { ...a, approved: newApproved } : a
        ),
      }))
    } catch {}
    setTogglingAgent(null)
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0E1F3D', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div className="w-full max-w-xs">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: '#1a3258' }}>
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white text-center mb-1">Admin Panel</h1>
          <p className="text-sm text-center mb-6" style={{ color: '#9DB2CC' }}>StateGen · Internal</p>
          <form onSubmit={handlePin} className="space-y-3">
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="w-full px-4 py-3 rounded-xl text-sm outline-none text-center tracking-widest"
              style={{ background: '#1a3258', color: '#fff', border: pinError ? '1.5px solid #e05c5c' : '1.5px solid #2a4570', fontFamily: 'inherit' }}
            />
            {pinError && <p className="text-xs text-center" style={{ color: '#e05c5c' }}>Incorrect PIN</p>}
            <button type="submit" className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#5E8FD6' }}>
              Unlock →
            </button>
          </form>
        </div>
      </div>
    )
  }

  const total = companies.length
  const active = companies.filter(c => c['is active']).length
  const pending = total - active

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: '#faf9f5', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1A2B4A' }}>StateGen Admin</h1>
            <p className="text-sm mt-1" style={{ color: '#7A8499' }}>Company & agent activation panel</p>
          </div>
          <button
            onClick={() => { setCreateErr(''); setCreateOpen(true) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white shrink-0"
            style={{ background: '#0E1F3D' }}
          >
            <Plus className="h-4 w-4" /> New company
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total', value: total, icon: Building2, color: '#5E8FD6', bg: '#EAF0FA' },
            { label: 'Active', value: active, icon: CheckCircle2, color: '#1F7A4D', bg: '#E3F4EA' },
            { label: 'Pending', value: pending, icon: Clock, color: '#9A6516', bg: '#FBEFD6' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold" style={{ color: '#1A2B4A' }}>{value}</p>
                  <p className="text-xs" style={{ color: '#9AA3B2' }}>{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Companies list */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#EEF0F4' }}>
            <h2 className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>All Companies</h2>
            <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>Click ▶ to see agents · Click Activate to set expiry date</p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>Loading…</div>
          ) : loadError ? (
            <div className="py-12 px-6 text-center text-sm mx-4 my-4 rounded-xl" style={{ background: '#FBE7E7', color: '#A23434', border: '1px solid #F0CFCF' }}>{loadError}</div>
          ) : companies.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>No companies yet.</div>
          ) : (
            <div>
              {companies.map(company => {
                const isActive = company['is active']
                const isExpanded = expandedId === company.id
                const agents = agentsMap[company.id]
                const isPickerOpen = activating === company.id

                return (
                  <div key={company.id} style={{ borderBottom: '1px solid #EEF0F4' }}>
                    {/* Company row */}
                    <div className="px-5 py-4 flex items-center gap-3">
                      <button
                        onClick={() => expandCompany(company.id)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg"
                        style={{ background: isExpanded ? '#EAF0FA' : 'transparent', color: '#5E8FD6' }}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
                        <Building2 className="h-4 w-4" style={{ color: '#2E5288' }} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#1A2B4A' }}>{company.Name}</p>
                        <p className="text-xs truncate" style={{ color: '#9AA3B2' }}>
                          {company.domain} · {company.Plan}
                          {company.access_until && (
                            <span style={{ color: isActive ? '#1F7A4D' : '#9A6516' }}>
                              {' '}· expires {fmtDate(company.access_until)}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1.5">
                          {isActive
                            ? <CheckCircle2 className="h-4 w-4" style={{ color: '#1F7A4D' }} />
                            : <XCircle className="h-4 w-4" style={{ color: '#9AA3B2' }} />
                          }
                          <span className="text-xs font-medium" style={{ color: isActive ? '#1F7A4D' : '#9AA3B2' }}>
                            {isActive ? 'Active' : 'Pending'}
                          </span>
                        </div>

                        <button
                          onClick={() => openInvoices(company)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: '#F1EDF9', color: '#5B3AA2' }}
                        >
                          Invoices
                        </button>

                        {isActive ? (
                          <div className="flex gap-2">
                            {/* Extend button */}
                            <button
                              onClick={() => openActivatePicker(company)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ background: '#EAF0FA', color: '#2E5288' }}
                            >
                              Extend
                            </button>
                            {/* Deactivate button */}
                            <button
                              onClick={() => deactivate(company)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ background: '#FBE7E7', color: '#A23434' }}
                            >
                              Deactivate
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => openActivatePicker(company)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: '#E3F4EA', color: '#1F7A4D' }}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Activation date picker */}
                    {isPickerOpen && (
                      <div ref={pickerRef} className="mx-5 mb-4 rounded-2xl p-4" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar className="h-4 w-4" style={{ color: '#2E5288' }} />
                          <p className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>
                            {isActive ? 'Extend access until' : 'Activate until'}
                          </p>
                        </div>

                        {/* Quick options */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          {QUICK.map(q => (
                            <button
                              key={q.days}
                              onClick={() => setUntilDate(addDays(q.days))}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              style={untilDate === addDays(q.days)
                                ? { background: '#0E1F3D', color: '#fff' }
                                : { background: '#fff', color: '#1A2B4A', border: '1px solid #D8E2F0' }
                              }
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>

                        {/* Custom date */}
                        <div className="flex items-center gap-3">
                          <input
                            type="date"
                            value={untilDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={e => setUntilDate(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                            style={{ border: '1.5px solid #D8E2F0', color: '#1A2B4A', background: '#fff', fontFamily: 'inherit' }}
                          />
                          <button
                            onClick={() => confirmActivate(company)}
                            disabled={!untilDate || saving}
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: '#1F7A4D' }}
                          >
                            {saving ? '…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setActivating(null)}
                            className="px-3 py-2 rounded-xl text-sm font-semibold"
                            style={{ background: '#fff', color: '#9AA3B2', border: '1px solid #D8E2F0' }}
                          >
                            Cancel
                          </button>
                        </div>

                        {untilDate && (
                          <p className="text-xs mt-2" style={{ color: '#5E8FD6' }}>
                            Access active until {fmtDate(untilDate)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Agents panel */}
                    {isExpanded && (
                      <div className="px-5 pb-4" style={{ background: '#F7F8FB' }}>
                        <p className="text-xs font-semibold mb-3 pt-3" style={{ color: '#6A7488' }}>AGENTS</p>
                        {agentsLoading === company.id ? (
                          <p className="text-xs py-4 text-center" style={{ color: '#9AA3B2' }}>Loading agents…</p>
                        ) : !agents || agents.length === 0 ? (
                          <p className="text-xs py-4 text-center" style={{ color: '#9AA3B2' }}>No agents yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {agents.map(agent => (
                              <div key={agent.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F0F2F7' }}>
                                  <User className="h-3.5 w-3.5" style={{ color: '#6A7488' }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate" style={{ color: '#1A2B4A' }}>{agent.Full_name}</p>
                                  <p className="text-xs" style={{ color: '#9AA3B2' }}>
                                    {agent.role}{agent.agent_code ? ` · ${agent.agent_code}` : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-medium" style={{ color: agent.approved ? '#1F7A4D' : '#9A6516' }}>
                                    {agent.approved ? 'Open' : 'Pending'}
                                  </span>
                                  <button
                                    onClick={() => toggleAgent(company.id, agent)}
                                    disabled={togglingAgent === agent.id}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
                                    style={agent.approved
                                      ? { background: '#FBE7E7', color: '#A23434' }
                                      : { background: '#E3F4EA', color: '#1F7A4D' }
                                    }
                                  >
                                    {togglingAgent === agent.id ? '…' : agent.approved ? 'Close' : 'Open'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create-company modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,40,0.55)' }} onClick={() => setCreateOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #EEF0F4' }}>
              <h2 className="text-base font-bold" style={{ color: '#1A2B4A' }}>New company</h2>
              <button onClick={() => setCreateOpen(false)} style={{ color: '#9AA3B2' }}><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              {createErr && <div className="text-sm rounded-xl px-3 py-2" style={{ background: '#FDF5F5', color: '#A23434' }}>{createErr}</div>}
              {([
                ['companyName', 'Company name', 'text', 'Cedars Realty'],
                ['domain', 'Domain', 'text', 'cedarsrealty.com'],
                ['email', 'Manager email', 'email', 'manager@cedarsrealty.com'],
                ['password', 'Temporary password', 'text', 'at least 8 characters'],
              ] as const).map(([key, label, type, ph]) => (
                <div key={key}>
                  <label className="text-xs font-semibold" style={{ color: '#6A7488' }}>{label}</label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={ph}
                    className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1.5px solid #EEF0F4', color: '#1A2B4A', background: '#fff' }}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold" style={{ color: '#6A7488' }}>Plan</label>
                <select
                  value={form.planId}
                  onChange={e => setForm(f => ({ ...f, planId: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ border: '1.5px solid #EEF0F4', color: '#1A2B4A', background: '#fff' }}
                >
                  {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} — ${p.price}/mo</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#1A2B4A' }}>
                <input type="checkbox" checked={form.activate} onChange={e => setForm(f => ({ ...f, activate: e.target.checked }))} />
                Activate now with a 30-day trial
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid #EEF0F4' }}>
              <button onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color: '#6A7488' }}>Cancel</button>
              <button
                onClick={createCompany}
                disabled={createBusy || !form.companyName || !form.domain || !form.email || form.password.length < 8}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: '#0E1F3D' }}
              >
                {createBusy ? 'Creating…' : 'Create company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      {invoicesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,31,61,0.45)' }} onClick={e => e.target === e.currentTarget && setInvoicesFor(null)}>
          <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-base font-bold" style={{ color: '#1A2B4A' }}>Invoices</p>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>{invoicesFor.Name} · {invoicesFor.domain}</p>
              </div>
              <button onClick={() => setInvoicesFor(null)} className="text-lg leading-none" style={{ color: '#9AA3B2' }}>✕</button>
            </div>

            {/* New invoice */}
            <div className="rounded-xl p-3" style={{ background: '#FAFBFC', border: '1px solid #EEF0F4' }}>
              <p className="text-xs font-bold mb-2" style={{ color: '#1A2B4A' }}>New invoice</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs" style={{ color: '#6A7488' }}>Plan
                  <select value={invForm.planId} onChange={e => { const p = PLANS.find(x => x.id === e.target.value) ?? PLANS[0]; setInvForm(f => ({ ...f, planId: p.id, subtotal: String(p.price) })) }} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }}>
                    {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} (${p.price})</option>)}
                  </select>
                </label>
                <label className="text-xs" style={{ color: '#6A7488' }}>Months
                  <input type="number" min="1" value={invForm.months} onChange={e => setInvForm(f => ({ ...f, months: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }} />
                </label>
                <label className="text-xs" style={{ color: '#6A7488' }}>Price / month (USD)
                  <input type="number" value={invForm.subtotal} onChange={e => setInvForm(f => ({ ...f, subtotal: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }} />
                </label>
                <label className="text-xs" style={{ color: '#6A7488' }}>Discount %
                  <input type="number" min="0" max="100" value={invForm.discountPct} onChange={e => setInvForm(f => ({ ...f, discountPct: e.target.value }))} placeholder="0" className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }} />
                </label>
                <label className="text-xs col-span-2" style={{ color: '#6A7488' }}>Method (optional)
                  <input value={invForm.method} onChange={e => setInvForm(f => ({ ...f, method: e.target.value }))} placeholder="bank transfer / cash / OMT" className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }} />
                </label>
                <label className="text-xs col-span-2" style={{ color: '#6A7488' }}>Note (optional)
                  <input value={invForm.note} onChange={e => setInvForm(f => ({ ...f, note: e.target.value }))} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }} />
                </label>
              </div>
              <div className="flex items-center justify-between mt-3">
                <p className="text-sm" style={{ color: '#1A2B4A' }}>Total: <span className="font-extrabold">${invTotal().toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> <span className="text-xs" style={{ color: '#9AA3B2' }}>({invMonths()} mo{Number(invForm.discountPct) > 0 ? ` · ${invForm.discountPct}% off` : ''})</span></p>
                <button onClick={createInvoice} disabled={invBusy} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>{invBusy ? 'Creating…' : 'Create invoice'}</button>
              </div>
              {invErr && <p className="text-xs mt-2" style={{ color: '#A23434' }}>{invErr}</p>}
            </div>

            {/* Existing invoices */}
            <div className="mt-4 space-y-2">
              {invLoading ? (
                <p className="text-xs text-center py-4" style={{ color: '#9AA3B2' }}>Loading…</p>
              ) : invoices.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: '#9AA3B2' }}>No invoices yet.</p>
              ) : invoices.map(iv => {
                const badge = iv.status === 'paid' ? { background: '#E3F4EA', color: '#1F7A4D' } : iv.status === 'void' ? { background: '#F1F1F1', color: '#777' } : { background: '#FBEFD6', color: '#9A6516' }
                return (
                  <div key={iv.id} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ border: '1px solid #EEF0F4' }}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>{iv.number} · ${Number(iv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}{(iv.discount_pct ?? 0) > 0 && <span className="text-xs ml-1" style={{ color: '#1F7A4D' }}>({iv.discount_pct}% off)</span>}</p>
                      <p className="text-xs" style={{ color: '#9AA3B2' }}>{iv.plan} · {iv.period_start} → {iv.period_end}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={badge}>{iv.status}</span>
                      <button onClick={() => printInvoice(iv)} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A' }}>Print</button>
                      {iv.status === 'unpaid' && (
                        <>
                          <button onClick={() => setInvoiceStatus(iv.id, 'paid')} className="text-xs font-bold px-2 py-1 rounded-lg text-white" style={{ background: '#1B8A4B' }}>Mark paid</button>
                          <button onClick={() => setInvoiceStatus(iv.id, 'void')} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}>Void</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs mt-3" style={{ color: '#9AA3B2' }}>Marking an invoice paid activates the company through its period end.</p>
          </div>
        </div>
      )}
    </div>
  )
}
