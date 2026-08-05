'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Shield, Check, Clock, Ban, Plus, ChevronDown } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { PLANS } from '@/lib/stripe-plans'
import Logo from '@/components/brand/Logo'

const H = '#1A2B4A'
const SUB = '#7A8499'

type Company = {
  id: number; name: string; domain: string; plan: string; agentLimit: number | null
  accessStatus: string; accessUntil: string | null; createdAt: string; seats: number; unpaidInvoices: number
}
type Invoice = {
  id: string; number: string; plan: string; amount: number; currency: string
  period_start: string; period_end: string; status: string; method: string | null; note: string | null; paid_at: string | null
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  active:    { bg: '#E4F7EC', color: '#1B8A4B' },
  pending:   { bg: '#FBEFD6', color: '#9A6516' },
  expired:   { bg: '#FBE7E7', color: '#A23434' },
  suspended: { bg: '#F0F2F5', color: '#6A7488' },
}
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : '—'

export default function AdminPage() {
  const { session } = useSession()
  const isAdmin = session?.isPlatformAdmin === true

  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [invoices, setInvoices] = useState<Record<number, Invoice[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCompanies = useCallback(async () => {
    const r = await fetch('/api/admin/companies').then(x => x.ok ? x.json() : null).catch(() => null)
    setCompanies(r?.companies ?? [])
  }, [])
  useEffect(() => { if (isAdmin) loadCompanies() }, [isAdmin, loadCompanies])

  async function loadInvoices(companyId: number) {
    const r = await fetch(`/api/admin/invoices?companyId=${companyId}`).then(x => x.ok ? x.json() : null).catch(() => null)
    setInvoices(prev => ({ ...prev, [companyId]: r?.invoices ?? [] }))
  }
  function toggle(id: number) {
    setOpenId(cur => cur === id ? null : id)
    if (openId !== id && !invoices[id]) loadInvoices(id)
  }

  async function patchCompany(id: number, patch: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/companies', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Update failed'); return }
      await loadCompanies()
    } finally { setBusy(false) }
  }

  async function createInvoice(c: Company) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: c.id, plan: c.plan }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Could not create invoice'); return }
      await loadInvoices(c.id)
    } finally { setBusy(false) }
  }

  async function markInvoice(companyId: number, invId: string, status: 'paid' | 'void', method?: string) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/invoices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: invId, status, method }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Update failed'); return }
      await Promise.all([loadInvoices(companyId), loadCompanies()])
    } finally { setBusy(false) }
  }

  if (session && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
        <div className="text-center">
          <p className="text-sm" style={{ color: SUB }}>This area is for StateGen operators only.</p>
          <Link href="/dashboard" className="text-sm font-semibold mt-2 inline-block" style={{ color: '#5E8FD6' }}>Back to app →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#faf9f5' }}>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Shield className="h-6 w-6" style={{ color: '#2E5288' }} />
            <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>StateGen Admin</h1>
          </div>
          <Logo size={26} withWordmark />
        </div>
        <p className="text-sm mb-6" style={{ color: SUB }}>Activate companies, manage plans, and record invoice payments.</p>

        {error && <p className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          {companies === null ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: SUB }}>Loading…</p>
          ) : companies.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: SUB }}>No companies yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
              {companies.map(c => {
                const st = STATUS_STYLE[c.accessStatus] ?? STATUS_STYLE.suspended
                const open = openId === c.id
                return (
                  <div key={c.id}>
                    <button onClick={() => toggle(c.id)} className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: H }}>{c.name} <span className="font-normal" style={{ color: SUB }}>· {c.domain}</span></p>
                        <p className="text-xs mt-0.5" style={{ color: SUB }}>
                          {c.plan} · {c.seats}{c.agentLimit != null ? `/${c.agentLimit}` : ''} agents · until {fmtDate(c.accessUntil)}
                          {c.unpaidInvoices > 0 && <span style={{ color: '#9A6516' }}> · {c.unpaidInvoices} unpaid</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={st}>{c.accessStatus}</span>
                        <ChevronDown className="h-4 w-4 transition-transform" style={{ color: '#C4CAD6', transform: open ? 'rotate(180deg)' : 'none' }} />
                      </div>
                    </button>

                    {open && (
                      <div className="px-4 pb-4 space-y-4" style={{ background: '#F9FAFC' }}>
                        {/* Plan + access controls */}
                        <div className="flex flex-wrap items-center gap-2 pt-3">
                          <label className="text-xs font-semibold" style={{ color: SUB }}>Plan</label>
                          <select
                            value={c.plan}
                            disabled={busy}
                            onChange={e => patchCompany(c.id, { plan: e.target.value })}
                            className="text-xs rounded-lg px-2 py-1.5" style={{ border: '1px solid #D7DCE5', background: '#fff', color: H }}
                          >
                            {PLANS.map(p => <option key={p.id} value={p.id}>{p.name} (${p.price}, {p.agentLimit ?? '∞'} agents)</option>)}
                          </select>
                          {c.accessStatus === 'suspended'
                            ? <button disabled={busy} onClick={() => patchCompany(c.id, { access_status: 'active' })} className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-white" style={{ background: '#1B8A4B' }}>Reactivate</button>
                            : <button disabled={busy} onClick={() => patchCompany(c.id, { access_status: 'suspended', access_until: null })} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}><Ban className="h-3 w-3" /> Suspend</button>}
                        </div>

                        {/* Access period — grant/extend without an invoice (free trials, comps) */}
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs font-semibold" style={{ color: SUB }}>Access until</label>
                          <button disabled={busy}
                            onClick={() => patchCompany(c.id, { access_status: 'active', access_until: new Date(Date.now() + 30 * 86400000).toISOString() })}
                            className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-white" style={{ background: '#1B8A4B' }}>Free trial · 30 days</button>
                          <button disabled={busy}
                            onClick={() => { const base = c.accessUntil && new Date(c.accessUntil) > new Date() ? new Date(c.accessUntil).getTime() : Date.now(); patchCompany(c.id, { access_status: 'active', access_until: new Date(base + 30 * 86400000).toISOString() }) }}
                            className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1.5px solid #D7DCE5', background: '#fff', color: H }}>Extend +1 month</button>
                          <input type="date" disabled={busy} defaultValue={c.accessUntil ? c.accessUntil.slice(0, 10) : ''}
                            onChange={e => e.target.value && patchCompany(c.id, { access_status: 'active', access_until: new Date(e.target.value).toISOString() })}
                            className="text-xs rounded-lg px-2 py-1.5" style={{ border: '1px solid #D7DCE5', background: '#fff', color: H }} />
                        </div>

                        {/* Invoices */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold" style={{ color: H }}>Invoices</p>
                            <button disabled={busy} onClick={() => createInvoice(c)} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg text-white" style={{ background: '#0E1F3D' }}>
                              <Plus className="h-3 w-3" /> New invoice ({c.plan})
                            </button>
                          </div>
                          <div className="rounded-xl bg-white overflow-hidden" style={{ border: '1px solid #EEF0F4' }}>
                            {(invoices[c.id] ?? []).length === 0 ? (
                              <p className="px-4 py-4 text-xs text-center" style={{ color: SUB }}>No invoices yet.</p>
                            ) : (invoices[c.id] ?? []).map(inv => (
                              <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid #F4F5F8' }}>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold" style={{ color: H }}>{inv.number} · ${Number(inv.amount).toLocaleString()} {inv.currency}</p>
                                  <p className="text-xs" style={{ color: SUB }}>{inv.period_start} → {inv.period_end}{inv.method ? ` · ${inv.method}` : ''}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={inv.status === 'paid' ? { background: '#E4F7EC', color: '#1B8A4B' } : inv.status === 'void' ? { background: '#F0F2F5', color: '#6A7488' } : { background: '#FBEFD6', color: '#9A6516' }}>
                                    {inv.status === 'paid' ? <Check className="h-3 w-3 inline" /> : <Clock className="h-3 w-3 inline" />} {inv.status}
                                  </span>
                                  {inv.status === 'unpaid' && (
                                    <button disabled={busy} onClick={() => markInvoice(c.id, inv.id, 'paid')} className="text-xs font-bold px-2.5 py-1 rounded-lg text-white" style={{ background: '#1B8A4B' }}>Mark paid</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs mt-1.5" style={{ color: SUB }}>Marking an invoice paid activates the company through its period end.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
