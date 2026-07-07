'use client'

import { useState } from 'react'
import { TrendingUp, DollarSign, CalendarClock, BadgeDollarSign, X, ChevronRight } from 'lucide-react'
import { DEALS, AGENTS, PROPERTIES, getAgent, TYPE_GRADIENTS, Deal, formatPrice, typeStyle, PropertyType } from '@/lib/data'

const H   = '#1A2B4A'
const SUB = '#7A8499'

type KpiKey = 'sold' | 'avgprice' | 'avgdays' | 'commission'
type AgentId = string | null
type TypeKey = string | null

const TYPE_BAR_COLORS: Record<string, string> = {
  Appartement: '#2E5288',
  Villa:       '#1F8A5B',
  Office:      '#4A5A70',
  Building:    '#6A4A90',
  Shop:        '#9A6516',
  Land:        '#2E7A4A',
  Showroom:    '#9A3460',
  Restaurant:  '#C04A20',
}

const typeNames: PropertyType[] = ['Appartement', 'Villa', 'Office', 'Building', 'Shop', 'Land', 'Showroom', 'Restaurant']

export default function AnalyticsPage() {
  const [kpiPanel, setKpiPanel]       = useState<KpiKey | null>(null)
  const [agentFilter, setAgentFilter] = useState<AgentId>(null)
  const [typeFilter, setTypeFilter]   = useState<TypeKey>(null)
  const [dealModal, setDealModal]     = useState<Deal | null>(null)

  function toggleKpi(k: KpiKey) {
    setKpiPanel(prev => prev === k ? null : k)
    setAgentFilter(null)
    setTypeFilter(null)
  }
  function toggleAgent(id: string) {
    setAgentFilter(prev => prev === id ? null : id)
    setKpiPanel(null)
    setTypeFilter(null)
  }
  function toggleType(t: string) {
    setTypeFilter(prev => prev === t ? null : t)
    setKpiPanel(null)
    setAgentFilter(null)
  }

  // ── derived data ──
  const agentDeals = AGENTS.map(a => ({
    agent: a,
    deals: DEALS.filter(d => d.agentId === a.id).length + (a.id === 'a2' ? 5 : a.id === 'a1' ? 3 : a.id === 'a3' ? 2 : 1),
    actualDeals: DEALS.filter(d => d.agentId === a.id),
    commission: DEALS.filter(d => d.agentId === a.id).reduce((s, d) => s + d.value * 0.025, 0)
      + (a.id === 'a2' ? 5 : a.id === 'a1' ? 3 : a.id === 'a3' ? 2 : 1) * 15000,
  })).sort((a, b) => b.deals - a.deals)
  const maxDeals = agentDeals[0]?.deals ?? 1

  const typeCounts = typeNames.map(t => ({
    type: t,
    count: PROPERTIES.filter(p => p.type === t && (p.status === 'Sold' || p.status === 'Reserved')).length
      + (t === 'Appartement' ? 9 : t === 'Villa' ? 7 : t === 'Building' ? 4 : 3),
    properties: PROPERTIES.filter(p => p.type === t),
  }))
  const maxTypeCount = Math.max(...typeCounts.map(t => t.count))

  const allDealsDesc   = [...DEALS].sort((a, b) => b.value - a.value)
  const allDealsByDays = [...DEALS].sort((a, b) => a.days - b.days)
  const avgPrice       = Math.round(DEALS.reduce((s, d) => s + d.value, 0) / DEALS.length)
  const avgDays        = Math.round(DEALS.reduce((s, d) => s + d.days, 0) / DEALS.length)
  const totalComm      = Math.round(DEALS.reduce((s, d) => s + d.value * 0.025, 0))

  const reportKpis: { key: KpiKey; label: string; value: string; sub: string; subColor: string; iconBg: string; iconFg: string; Icon: React.ElementType }[] = [
    { key: 'sold',       label: 'Properties sold',  value: '23',     sub: '↑ 4 vs last month', subColor: '#1F7A4D', iconBg: '#EAF0FA', iconFg: '#2E5288', Icon: TrendingUp      },
    { key: 'avgprice',   label: 'Avg sale price',   value: '$618K',  sub: '↑ 7% vs last month',subColor: '#1F7A4D', iconBg: '#E3F4EA', iconFg: '#1F8A5B', Icon: DollarSign      },
    { key: 'avgdays',    label: 'Avg days to close',value: '38',     sub: '↓ 5 days faster',   subColor: '#9A6516', iconBg: '#FBEFD6', iconFg: '#9A6516', Icon: CalendarClock   },
    { key: 'commission', label: 'Commission MTD',    value: '$87K',   sub: '↑ 12% this month',  subColor: '#1F7A4D', iconBg: '#FBE7E7', iconFg: '#A23434', Icon: BadgeDollarSign },
  ]

  // ── shared row component ──
  function DealRow({ d, showDays = false }: { d: Deal; showDays?: boolean }) {
    const agent = getAgent(d.agentId)
    return (
      <div
        onClick={() => setDealModal(d)}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        style={{ borderBottom: '1px solid #F4F5F8' }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: H }}>{d.propTitle}</p>
          <p className="text-xs" style={{ color: SUB }}>{d.location}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: '#EAF0FA', color: '#2E5288' }}>{d.type}</span>
        <p className="text-sm font-semibold shrink-0" style={{ color: H }}>USD {d.value.toLocaleString()}</p>
        {showDays && <span className="text-xs shrink-0" style={{ color: SUB }}>{d.days}d</span>}
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{agent.initials}</div>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: '#C4CAD6' }} />
      </div>
    )
  }

  function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <p className="text-sm font-semibold" style={{ color: H }}>{title}</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div>
        <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Reports</h1>
        <p className="text-sm mt-0.5" style={{ color: SUB }}>Agency performance overview — click anything to drill in</p>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {reportKpis.map(({ key, label, value, sub, subColor, iconBg, iconFg, Icon }) => (
          <div
            key={key}
            onClick={() => toggleKpi(key)}
            className="rounded-2xl p-5 bg-white cursor-pointer transition-all"
            style={{
              boxShadow: kpiPanel === key ? '0 0 0 2px #5E8FD6, 0 2px 8px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.06)',
              border: kpiPanel === key ? '1px solid #5E8FD6' : '1px solid #EEF0F4',
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: iconBg }}>
              <Icon className="h-5 w-5" style={{ color: iconFg }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>{value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: SUB }}>{label}</p>
            <p className="text-xs mt-1 font-medium" style={{ color: subColor }}>{sub}</p>
            <p className="text-xs mt-2 font-semibold" style={{ color: '#5E8FD6' }}>Click to view →</p>
          </div>
        ))}
      </div>

      {/* ── KPI drill-down panels ── */}
      {kpiPanel === 'sold' && (
        <Panel title={`All Closed Deals (${DEALS.length})`} onClose={() => setKpiPanel(null)}>
          {allDealsDesc.map(d => <DealRow key={d.id} d={d} />)}
        </Panel>
      )}

      {kpiPanel === 'avgprice' && (
        <Panel title={`Avg Sale Price — $${avgPrice.toLocaleString()} per deal`} onClose={() => setKpiPanel(null)}>
          <div className="divide-y" style={{ divideColor: '#F4F5F8' }}>
            {agentDeals.map(({ agent, actualDeals }) => {
              const avg = actualDeals.length ? Math.round(actualDeals.reduce((s, d) => s + d.value, 0) / actualDeals.length) : 0
              return (
                <div key={agent.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{agent.initials}</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: H }}>{agent.name}</p>
                    <p className="text-xs" style={{ color: SUB }}>{actualDeals.length} deals</p>
                  </div>
                  <p className="text-sm font-semibold" style={{ color: H }}>{avg > 0 ? `USD ${avg.toLocaleString()}` : '—'}</p>
                </div>
              )
            })}
          </div>
          <div className="px-5 py-3" style={{ borderTop: '1px solid #EEF0F4', background: '#F7F8FB' }}>
            <p className="text-xs font-semibold" style={{ color: SUB }}>Agency avg: <span style={{ color: H }}>USD {avgPrice.toLocaleString()}</span></p>
          </div>
        </Panel>
      )}

      {kpiPanel === 'avgdays' && (
        <Panel title={`Days to Close — avg ${avgDays} days`} onClose={() => setKpiPanel(null)}>
          {allDealsByDays.map(d => <DealRow key={d.id} d={d} showDays />)}
        </Panel>
      )}

      {kpiPanel === 'commission' && (
        <Panel title={`Commission MTD — USD ${totalComm.toLocaleString()} total`} onClose={() => setKpiPanel(null)}>
          <div className="divide-y" style={{ divideColor: '#F4F5F8' }}>
            {agentDeals.map(({ agent, commission, actualDeals }) => (
              <div key={agent.id} className="flex items-center gap-4 px-5 py-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{agent.initials}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: H }}>{agent.name}</p>
                  <p className="text-xs" style={{ color: SUB }}>{actualDeals.length} closed deals · 2.5% rate</p>
                </div>
                <p className="text-sm font-bold" style={{ color: '#1F7A4D' }}>USD {Math.round(commission).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="px-5 py-3" style={{ borderTop: '1px solid #EEF0F4', background: '#F7F8FB' }}>
            <p className="text-xs font-semibold" style={{ color: SUB }}>Total: <span style={{ color: H }}>USD {totalComm.toLocaleString()}</span></p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Sales by Agent ── */}
        <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <h2 className="text-sm font-bold mb-1" style={{ color: H }}>Sales by Agent</h2>
          <p className="text-xs mb-4" style={{ color: SUB }}>Click a row to see that agent&apos;s deals</p>
          <div className="space-y-3">
            {agentDeals.map(({ agent, deals }) => (
              <div
                key={agent.id}
                onClick={() => toggleAgent(agent.id)}
                className="rounded-xl p-3 cursor-pointer transition-all"
                style={{
                  background: agentFilter === agent.id ? '#F5F8FE' : 'transparent',
                  border: agentFilter === agent.id ? '1.5px solid #5E8FD6' : '1.5px solid transparent',
                }}
              >
                <div className="flex justify-between text-xs mb-1.5 items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: agent.color }}>{agent.initials}</div>
                    <span style={{ color: H, fontWeight: 600 }}>{agent.name}</span>
                  </div>
                  <span style={{ color: SUB }}>{deals} deals</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: '#EEF0F4' }}>
                  <div className="h-2 rounded-full transition-all" style={{ width: `${(deals / maxDeals) * 100}%`, background: agent.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sales by Type ── */}
        <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <h2 className="text-sm font-bold mb-1" style={{ color: H }}>Sales by Type</h2>
          <p className="text-xs mb-4" style={{ color: SUB }}>Click a row to see listings of that type</p>
          <div className="space-y-3">
            {typeCounts.map(({ type, count }) => (
              <div
                key={type}
                onClick={() => toggleType(type)}
                className="rounded-xl p-3 cursor-pointer transition-all"
                style={{
                  background: typeFilter === type ? '#F5F8FE' : 'transparent',
                  border: typeFilter === type ? '1.5px solid #5E8FD6' : '1.5px solid transparent',
                }}
              >
                <div className="flex justify-between text-xs mb-1.5 items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ background: TYPE_BAR_COLORS[type] }} />
                    <span style={{ color: H, fontWeight: 600 }}>{type}</span>
                  </div>
                  <span style={{ color: SUB }}>{count} sold</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: '#EEF0F4' }}>
                  <div className="h-2 rounded-full transition-all" style={{ width: `${(count / maxTypeCount) * 100}%`, background: TYPE_BAR_COLORS[type] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Agent drill-down ── */}
      {agentFilter && (() => {
        const ad = agentDeals.find(x => x.agent.id === agentFilter)!
        return (
          <Panel title={`${ad.agent.name}'s Deals (${ad.actualDeals.length})`} onClose={() => setAgentFilter(null)}>
            {ad.actualDeals.length > 0
              ? ad.actualDeals.map(d => <DealRow key={d.id} d={d} showDays />)
              : <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>No deals in data yet.</p>
            }
          </Panel>
        )
      })()}

      {/* ── Type drill-down ── */}
      {typeFilter && (() => {
        const tc = typeCounts.find(x => x.type === typeFilter)!
        return (
          <Panel title={`${typeFilter} Listings (${tc.properties.length})`} onClose={() => setTypeFilter(null)}>
            <div className="divide-y" style={{ divideColor: '#F4F5F8' }}>
              {tc.properties.map(p => {
                const agent = getAgent(p.agentId)
                return (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                    {p.photos?.[0]
                      ? <img src={p.photos[0]} alt="" className="w-12 h-9 rounded-lg object-cover shrink-0" />
                      : <div className="w-12 h-9 rounded-lg shrink-0" style={{ background: TYPE_GRADIENTS[p.type] }} />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: H }}>{p.title}</p>
                      <p className="text-xs" style={{ color: SUB }}>{p.district}, {p.city}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0" style={{ color: H }}>
                      {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                      style={{ background: p.status === 'Sold' ? '#EAF0FA' : p.status === 'Available' ? '#E3F4EA' : '#FBEFD6',
                               color:      p.status === 'Sold' ? '#2E5288' : p.status === 'Available' ? '#1F7A4D'  : '#9A6516' }}>
                      {p.status}
                    </span>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{agent.initials}</div>
                  </div>
                )
              })}
            </div>
          </Panel>
        )
      })()}

      {/* ── Top Closed Deals table ── */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <h2 className="text-sm font-bold" style={{ color: H }}>Top Closed Deals</h2>
          <p className="text-xs mt-0.5" style={{ color: SUB }}>Click a row for full details</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#F7F8FB', borderBottom: '1px solid #EEF0F4' }}>
              {['Property', 'Location', 'Agent', 'Value', 'Days'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold" style={{ color: '#9AA3B2', letterSpacing: '0.05em' }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEALS.slice(0, 3).map(deal => {
              const agent = getAgent(deal.agentId)
              return (
                <tr
                  key={deal.id}
                  onClick={() => setDealModal(deal)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: '1px solid #F4F5F8' }}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold" style={{ color: H }}>{deal.propTitle}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#EAF0FA', color: '#2E5288' }}>{deal.type}</span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: SUB }}>{deal.location}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: agent.color }}>{agent.initials}</div>
                      <span className="text-xs font-medium" style={{ color: H }}>{agent.shortName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-bold" style={{ color: H }}>USD {deal.value.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: SUB }}>{deal.days}d</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Deal detail modal ── */}
      {dealModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(14,31,61,0.45)' }}
          onClick={e => e.target === e.currentTarget && setDealModal(null)}
        >
          <div className="w-full max-w-sm rounded-2xl overflow-hidden bg-white" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
              <p className="font-semibold text-sm" style={{ color: H }}>Deal Details</p>
              <button onClick={() => setDealModal(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
            </div>
            <div className="p-5 space-y-4">
              {(() => {
                const agent = getAgent(dealModal.agentId)
                return (
                  <>
                    <div>
                      <p className="text-xs font-medium mb-0.5" style={{ color: SUB }}>Property</p>
                      <p className="text-base font-bold" style={{ color: H }}>{dealModal.propTitle}</p>
                      <p className="text-xs" style={{ color: SUB }}>{dealModal.location}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Type',        value: dealModal.type },
                        { label: 'Value',       value: `USD ${dealModal.value.toLocaleString()}` },
                        { label: 'Commission',  value: `USD ${Math.round(dealModal.value * 0.025).toLocaleString()}` },
                        { label: 'Days to close', value: `${dealModal.days} days` },
                        { label: 'Closed',      value: new Date(dealModal.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) },
                        { label: 'Client',      value: dealModal.clientName ?? '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                          <p className="text-xs" style={{ color: SUB }}>{label}</p>
                          <p className="text-sm font-semibold mt-0.5" style={{ color: H }}>{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 pt-1" style={{ borderTop: '1px solid #EEF0F4' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: agent.color }}>{agent.initials}</div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: H }}>{agent.name}</p>
                        <p className="text-xs" style={{ color: SUB }}>Closing Agent</p>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
