'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Building2, Users, Banknote, Clock, X, Plus, ChevronRight, UserCheck } from 'lucide-react'
import {
  getAgent,
  statusStyle, CLIENT_TYPE_STYLE, formatPrice, TYPE_GRADIENTS, typeStyle,
  Property, Client, Agent,
} from '@/lib/data'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { STAGES, type Stage } from '@/lib/pipeline'
import PropertyDetailModal from '@/components/modals/PropertyDetailModal'
import ClientDetailModal from '@/components/modals/ClientDetailModal'
import NewPropertyModal from '@/components/modals/NewPropertyModal'
import NewClientModal from '@/components/modals/NewClientModal'

type Panel = 'listings' | 'clients' | 'deals' | 'volume' | null

// A deal as returned by /api/deals (real pipeline data).
type DealView = {
  id: string
  clientName: string
  propertyLabel: string | null
  value: number
  stage: Stage
  outcome: 'won' | 'lost' | null
  stage_changed_at: string | null
  created_at: string
}

const COMMISSION_RATE = 2.5
const YEARS = [2026, 2025, 2024, 2023]
const stageLabelOf = (s: string) => STAGES.find(x => x.id === s)?.label ?? s

const H   = '#1A2B4A'
const SUB = '#7A8499'

export default function DashboardPage() {
  const [panel, setPanel]               = useState<Panel>(null)
  const [detailProp, setDetailProp]     = useState<Property | null>(null)
  const [detailClient, setDetailClient] = useState<Client | null>(null)
  const [detailDeal, setDetailDeal]     = useState<DealView | null>(null)
  const [newPropOpen, setNewPropOpen]   = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [props, setProps]               = useState<Property[]>([])
  const [clients, setClients]           = useState<Client[]>([])
  const [deals, setDeals]               = useState<DealView[]>([])
  const [loaded, setLoaded]             = useState(false)
  const [agents, setAgents]             = useState<Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>>({})
  const [editProp, setEditProp]         = useState<Property | null>(null)
  const [editClient, setEditClient]     = useState<Client | null>(null)
  const [toast, setToast]               = useState('')
  const [volumeYear, setVolumeYear]     = useState<number | null>(2026)

  // Pending agent-approval requests. /api/agents 403s for non-managers, so this
  // banner only ever shows for managers.
  const [pendingAgents, setPendingAgents] = useState(0)
  useEffect(() => {
    let live = true
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d && Array.isArray(d.pending)) setPendingAgents(d.pending.length) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  // Load live data. Always reflect the real result (even empty) so a new agency
  // never sees leftover demo data.
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    Promise.all([
      fetch('/api/properties', { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/clients', { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/deals', { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([pRes, cRes, dRes]) => {
      clearTimeout(t)
      if (pRes?.properties) setProps(pRes.properties.map(dbRowToProperty))
      if (cRes?.clients) setClients(cRes.clients.map(dbRowToClient))
      if (dRes?.deals) setDeals(dRes.deals as DealView[])
    }).catch(() => clearTimeout(t)).finally(() => setLoaded(true))
    fetch('/api/company/agents').then(r => r.ok ? r.json() : null).then(d => { if (d?.agents) setAgents(d.agents) }).catch(() => {})
    return () => { clearTimeout(t); ctrl.abort() }
  }, [])

  // Real agent for a code, falling back to the demo helper for legacy codes.
  const agentFor = (code: string): Agent => {
    const a = agents[code]
    return a
      ? { id: code as Agent['id'], name: a.name, initials: a.initials, color: a.color, shortName: a.name.split(' ')[0] }
      : getAgent(code as Agent['id'])
  }

  function upsertProp(p: Property) {
    setProps(prev => prev.some(x => x.id === p.id) ? prev.map(x => x.id === p.id ? p : x) : [p, ...prev])
  }
  function upsertClient(c: Client) {
    setClients(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev])
  }

  const activeListings = props.filter(p => p.status === 'Available')

  // Volume from real won deals; open deals are anything not yet closed.
  const wonDeals      = deals.filter(d => d.outcome === 'won')
  const openDeals     = deals.filter(d => d.stage !== 'closed')
  const dealYear      = (d: DealView) => new Date(d.stage_changed_at ?? d.created_at).getFullYear()
  const salesByYear   = YEARS.map(yr => ({ yr, deals: wonDeals.filter(d => dealYear(d) === yr) }))
  const maxYearVol    = Math.max(...salesByYear.map(y => y.deals.reduce((s, d) => s + (d.value || 0), 0)), 1)
  const volumeYTD     = wonDeals.filter(d => dealYear(d) === new Date().getFullYear()).reduce((s, d) => s + (d.value || 0), 0)
  const volumeAllTime = wonDeals.reduce((s, d) => s + (d.value || 0), 0)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }
  function togglePanel(p: Panel)  { setPanel(prev => prev === p ? null : p) }

  // Real recent activity: the newest listings, clients and closed deals, merged.
  const recentActivity = [
    ...props.map(p => ({ id: `p${p.id}`, ts: 0, color: '#5E8FD6', text: `Listing: ${p.title}`, onClick: () => setDetailProp(p) })),
    ...clients.map(c => ({ id: `c${c.id}`, ts: 0, color: '#A23434', text: `Client: ${c.name}`, onClick: () => setDetailClient(c) })),
    ...wonDeals.map(d => ({ id: `d${d.id}`, ts: new Date(d.stage_changed_at ?? d.created_at).getTime(), color: '#1F8A5B', text: `Deal won: ${d.clientName} — ${formatPrice(d.value)}`, onClick: () => setDetailDeal(d) })),
  ].slice(0, 6)

  const kpis = [
    { key: 'listings', label: 'Active listings', value: activeListings.length, sub: `${props.length} total`, subColor: SUB,      icon: Building2, iconBg: '#EAF0FA', iconFg: '#2E5288' },
    { key: 'clients',  label: 'Total clients',   value: clients.length,        sub: 'in your pipeline',   subColor: SUB, icon: Users,     iconBg: '#E3F4EA', iconFg: '#1F8A5B' },
    { key: 'volume',   label: 'Volume YTD',       value: volumeYTD >= 1_000_000 ? `$${(volumeYTD/1_000_000).toFixed(1)}M` : formatPrice(volumeYTD), sub: `${wonDeals.length} won all-time`, subColor: '#1F7A4D', icon: Banknote,  iconBg: '#FBEFD6', iconFg: '#9A6516' },
    { key: 'deals',    label: 'Open deals',       value: openDeals.length,      sub: `${deals.length} total`,   subColor: SUB, icon: Clock,     iconBg: '#FBE7E7', iconFg: '#A23434' },
  ] as const

  const recentProps = props.filter(p => p.status !== 'Sold').slice(0, 5)

  function DealRow({ d }: { d: DealView }) {
    const comm = Math.round((d.value || 0) * COMMISSION_RATE / 100)
    return (
      <div
        onClick={() => setDetailDeal(d)}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        style={{ borderBottom: '1px solid #F4F5F8' }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: H }}>{d.clientName}</p>
          <p className="text-xs truncate" style={{ color: SUB }}>{d.propertyLabel || stageLabelOf(d.stage)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold" style={{ color: H }}>{formatPrice(d.value)}</p>
          <p className="text-xs font-medium" style={{ color: '#1F7A4D' }}>+{formatPrice(comm)}</p>
        </div>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: '#C4CAD6' }} />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* ── Pending agent approvals (managers) ── */}
      {pendingAgents > 0 && (
        <Link
          href="/approvals"
          className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors"
          style={{ background: '#FBEFD6', border: '1px solid #F0DCB0' }}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#F5D999' }}>
            <UserCheck className="h-5 w-5" style={{ color: '#8A5A12' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#8A5A12' }}>
              {pendingAgents} agent{pendingAgents > 1 ? 's' : ''} waiting for approval
            </p>
            <p className="text-xs" style={{ color: '#9A6516' }}>
              New sign-up{pendingAgents > 1 ? 's' : ''} at your agency — review and approve to give access.
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs font-bold shrink-0" style={{ color: '#8A5A12' }}>
            Review <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      )}

      {/* ── First-run get-started (brand-new agency) ── */}
      {loaded && props.length === 0 && clients.length === 0 && (
        <div className="rounded-2xl p-5" style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <p className="text-sm font-bold" style={{ color: H }}>Welcome to StateGen 👋</p>
          <p className="text-xs mt-0.5 mb-4" style={{ color: SUB }}>Three quick steps to get your agency up and running.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { n: 1, title: 'Add your first listing', desc: 'Put a property on the board.', action: () => setNewPropOpen(true), cta: 'Add listing' },
              { n: 2, title: 'Add your first client', desc: 'Capture a buyer or renter brief.', action: () => setNewClientOpen(true), cta: 'Add client' },
              { n: 3, title: 'Invite your team', desc: 'Agents join with your company domain.', href: '/settings', cta: 'Open settings' },
            ].map(s => (
              <div key={s.n} className="rounded-xl p-4 flex flex-col" style={{ border: '1px solid #EEF0F4', background: '#F9FAFC' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mb-2" style={{ background: '#5E8FD6' }}>{s.n}</div>
                <p className="text-sm font-semibold" style={{ color: H }}>{s.title}</p>
                <p className="text-xs mt-0.5 mb-3 flex-1" style={{ color: SUB }}>{s.desc}</p>
                {s.href ? (
                  <Link href={s.href} className="text-xs font-bold" style={{ color: '#2E5288' }}>{s.cta} →</Link>
                ) : (
                  <button onClick={s.action} className="text-left text-xs font-bold" style={{ color: '#2E5288' }}>{s.cta} →</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Dashboard</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: SUB }}>Overview of your agency activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewClientOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-semibold transition-colors"
            style={{ border: '1.5px solid #D8DCE6', background: '#fff', color: '#1A2B4A' }}
          >
            <Plus className="h-3 w-3" /> Client
          </button>
          <button
            onClick={() => setNewPropOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-semibold text-white transition-colors"
            style={{ background: '#0E1F3D' }}
          >
            <Plus className="h-3 w-3" /> Property
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {kpis.map(({ key, label, value, sub, subColor, icon: Icon, iconBg, iconFg }) => (
          <div
            key={label}
            onClick={() => togglePanel(key as Panel)}
            className="rounded-2xl p-3 md:p-5 bg-white transition-all cursor-pointer"
            style={{
              boxShadow: panel === key ? '0 0 0 2px #5E8FD6, 0 2px 8px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.06)',
              border: panel === key ? '1px solid #5E8FD6' : '1px solid #EEF0F4',
            }}
          >
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center mb-2 md:mb-3" style={{ background: iconBg }}>
              <Icon className="h-4 w-4" style={{ color: iconFg }} />
            </div>
            <p className="text-lg md:text-2xl font-bold" style={{ color: H }}>{value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: SUB }}>{label}</p>
            <p className="text-xs mt-1 font-medium hidden md:block" style={{ color: subColor }}>{sub}</p>
            <p className="text-xs mt-1 md:mt-2 font-semibold" style={{ color: '#5E8FD6' }}>View →</p>
          </div>
        ))}
      </div>

      {/* ── Inline panels ── */}
      {panel && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <p className="text-sm font-semibold" style={{ color: H }}>
              {panel === 'listings' && `Active Listings (${activeListings.length})`}
              {panel === 'clients'  && `All Clients (${clients.length})`}
              {panel === 'deals'    && 'Open Deals'}
              {panel === 'volume'   && 'Sales Volume — All Years'}
            </p>
            <button onClick={() => setPanel(null)} className="p-1 rounded-lg hover:bg-gray-100">
              <X className="h-4 w-4" style={{ color: SUB }} />
            </button>
          </div>

          {/* Listings */}
          {panel === 'listings' && activeListings.map(p => {
            const agent = agentFor(p.agentId)
            const sc = statusStyle(p.status)
            return (
              <div key={p.id} onClick={() => setDetailProp(p)}
                className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ borderBottom: '1px solid #F4F5F8' }}>
                {p.photos?.[0]
                  ? <img src={p.photos[0]} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0" />
                  : <div className="w-12 h-9 rounded-lg shrink-0" style={{ background: TYPE_GRADIENTS[p.type] }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: H }}>{p.title}</p>
                  <p className="text-xs" style={{ color: SUB }}>{p.district}, {p.city}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold" style={{ color: H }}>
                    {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
                  </p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{p.status}</span>
                </div>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>
                  {agent.initials}
                </div>
              </div>
            )
          })}

          {/* Clients */}
          {panel === 'clients' && clients.map(c => {
            const agent = agentFor(c.agentId)
            const sc = statusStyle(c.status)
            const tc = CLIENT_TYPE_STYLE[c.type]
            const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)
            return (
              <div key={c.id} onClick={() => setDetailClient(c)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ borderBottom: '1px solid #F4F5F8' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: H }}>{c.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: SUB }}>{c.phone}</p>
                  <div className="flex gap-1.5 mt-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>{c.type}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{c.status}</span>
                  </div>
                </div>
                <p className="text-sm font-semibold shrink-0" style={{ color: H }}>{formatPrice(c.budget)}</p>
              </div>
            )
          })}

          {/* Open deals */}
          {panel === 'deals' && openDeals.length === 0 && (
            <p className="px-5 py-8 text-sm text-center" style={{ color: '#9AA3B2' }}>No open deals. Start one from the Pipeline.</p>
          )}
          {panel === 'deals' && openDeals.map(d => (
            <div key={d.id} onClick={() => setDetailDeal(d)}
              className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ borderBottom: '1px solid #F4F5F8' }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: H }}>{d.clientName}</p>
                <p className="text-xs truncate" style={{ color: SUB }}>{d.propertyLabel || '—'}</p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0" style={{ background: '#EAF0FA', color: '#2E5288' }}>{stageLabelOf(d.stage)}</span>
              <p className="text-sm font-semibold shrink-0" style={{ color: H }}>{formatPrice(d.value)}</p>
            </div>
          ))}

          {/* ── Volume panel ── */}
          {panel === 'volume' && (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-3" style={{ borderBottom: '1px solid #EEF0F4' }}>
                {[
                  { label: 'Volume YTD',    value: formatPrice(volumeYTD),     color: H },
                  { label: 'Commission YTD', value: formatPrice(Math.round(volumeYTD * COMMISSION_RATE / 100)), color: '#1F7A4D' },
                  { label: 'All-time volume', value: formatPrice(volumeAllTime), color: H },
                ].map(({ label, value, color }, i) => (
                  <div key={label} className="px-5 py-4" style={{ borderLeft: i > 0 ? '1px solid #EEF0F4' : 'none' }}>
                    <p className="text-xs" style={{ color: SUB }}>{label}</p>
                    <p className="text-base font-bold mt-0.5" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Year bars — click to expand deals */}
              {salesByYear.map(({ yr, deals }) => {
                const vol = deals.reduce((s, d) => s + d.value, 0)
                const pct = vol / maxYearVol * 100
                const expanded = volumeYear === yr
                return (
                  <div key={yr}>
                    <div
                      className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                      style={{ borderBottom: '1px solid #EEF0F4' }}
                      onClick={() => setVolumeYear(v => v === yr ? null : yr)}
                    >
                      <div className="flex justify-between text-xs mb-2">
                        <span className="font-semibold flex items-center gap-2" style={{ color: H }}>
                          {yr}
                          {deals.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                              {deals.length} sale{deals.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold" style={{ color: H }}>{formatPrice(vol)}</span>
                          <ChevronRight
                            className="h-3.5 w-3.5 transition-transform"
                            style={{ color: '#C4CAD6', transform: expanded ? 'rotate(90deg)' : 'none' }}
                          />
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full" style={{ background: '#EEF0F4' }}>
                        <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, background: '#5E8FD6' }} />
                      </div>
                      <p className="text-xs mt-1.5" style={{ color: SUB }}>
                        Commission: <span className="font-semibold" style={{ color: '#1F7A4D' }}>{formatPrice(Math.round(vol * COMMISSION_RATE / 100))}</span>
                      </p>
                    </div>
                    {expanded && deals.length > 0 && deals.map(d => <DealRow key={d.id} d={d} />)}
                    {expanded && deals.length === 0 && (
                      <p className="px-5 py-4 text-xs text-center" style={{ color: '#9AA3B2', borderBottom: '1px solid #EEF0F4' }}>No sales recorded in {yr}</p>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── Recent Properties + Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <p className="text-sm font-semibold mb-4" style={{ color: H }}>Recent Properties</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentProps.map(p => {
              const agent = agentFor(p.agentId)
              const sc = statusStyle(p.status)
              return (
                <div key={p.id} onClick={() => setDetailProp(p)}
                  className="rounded-xl overflow-hidden cursor-pointer transition-all"
                  style={{ border: '1px solid #EEF0F4' }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.09)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div className="relative h-20 overflow-hidden">
                    {p.photos?.[0]
                      ? <img src={p.photos[0]} alt={p.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full" style={{ background: TYPE_GRADIENTS[p.type] }} />
                    }
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 55%)' }} />
                    <p className="absolute bottom-2 left-2.5 text-xs font-semibold text-white truncate pr-8">{p.title}</p>
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: agent.color }}>
                      {agent.initials}
                    </div>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold" style={{ color: H }}>
                        {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
                      </p>
                      <p className="text-xs" style={{ color: SUB }}>
                        {p.beds > 0 ? `${p.beds}bd · ` : ''}{p.baths}ba · {p.size}m²
                      </p>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                      {p.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <p className="text-sm font-semibold mb-4" style={{ color: H }}>Recent Activity</p>
          <div className="space-y-4">
            {recentActivity.length === 0 && (
              <p className="text-xs" style={{ color: '#9AA3B2' }}>Nothing yet — add a listing or a client to get started.</p>
            )}
            {recentActivity.map(a => (
              <div key={a.id} onClick={a.onClick} className="flex gap-3 cursor-pointer group">
                <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                <div>
                  <p className="text-xs leading-snug transition-colors group-hover:underline" style={{ color: H }}>{a.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Deal detail modal ── */}
      {detailDeal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
          style={{ background: 'rgba(14,31,61,0.45)' }}
          onClick={e => e.target === e.currentTarget && setDetailDeal(null)}>
          <div className="w-full md:max-w-sm md:rounded-2xl rounded-t-2xl overflow-hidden bg-white" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
              <p className="font-semibold text-sm" style={{ color: H }}>Deal</p>
              <button onClick={() => setDetailDeal(null)} style={{ color: SUB }} className="text-lg leading-none hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs" style={{ color: SUB }}>Client</p>
                <p className="text-base font-semibold mt-0.5" style={{ color: H }}>{detailDeal.clientName}</p>
                {detailDeal.propertyLabel && <p className="text-xs" style={{ color: SUB }}>{detailDeal.propertyLabel}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Stage',      value: detailDeal.outcome ? `Closed (${detailDeal.outcome})` : stageLabelOf(detailDeal.stage), color: H },
                  { label: 'Value',      value: formatPrice(detailDeal.value), color: H },
                  { label: 'Commission', value: formatPrice(Math.round((detailDeal.value || 0) * COMMISSION_RATE / 100)), color: '#1F7A4D' },
                  { label: 'Updated',    value: new Date(detailDeal.stage_changed_at ?? detailDeal.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }), color: H },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                    <p className="text-xs" style={{ color: SUB }}>{label}</p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
              <a href="/pipeline" className="block w-full text-center py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
                Manage in Pipeline →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 px-4 py-2.5 rounded-xl text-sm font-medium text-white z-50"
          style={{ background: '#1F7A4D', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {detailProp && (
        <PropertyDetailModal
          property={detailProp}
          agent={agentFor(detailProp.agentId)}
          onClose={() => setDetailProp(null)}
          onEdit={p => { setDetailProp(null); setEditProp(p) }}
        />
      )}
      {detailClient && (
        <ClientDetailModal
          client={detailClient}
          agent={agentFor(detailClient.agentId)}
          onClose={() => setDetailClient(null)}
          onEdit={c => { setDetailClient(null); setEditClient(c) }}
          onStatusChange={(id, status) => setClients(prev => prev.map(x => x.id === id ? { ...x, status } : x))}
        />
      )}
      {newPropOpen && (
        <NewPropertyModal
          onClose={() => setNewPropOpen(false)}
          onSaved={p => { upsertProp(p); setNewPropOpen(false); showToast('Listing saved!') }}
        />
      )}
      {editProp && (
        <NewPropertyModal
          initial={editProp}
          onClose={() => setEditProp(null)}
          onSaved={p => { upsertProp(p); setEditProp(null); showToast('Changes saved!') }}
        />
      )}
      {newClientOpen && (
        <NewClientModal
          onClose={() => setNewClientOpen(false)}
          onSaved={c => { upsertClient(c); setNewClientOpen(false); showToast('Client saved!') }}
        />
      )}
      {editClient && (
        <NewClientModal
          initial={editClient}
          onClose={() => setEditClient(null)}
          onSaved={c => { upsertClient(c); setEditClient(null); showToast('Changes saved!') }}
        />
      )}
    </div>
  )
}
