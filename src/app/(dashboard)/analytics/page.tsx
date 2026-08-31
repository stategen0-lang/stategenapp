'use client'

import { useState } from 'react'
import { TrendingUp, DollarSign, Percent, Wallet, Trophy, HandCoins, Home, Users, ArrowUp, ArrowDown } from 'lucide-react'
import { formatPrice } from '@/lib/data'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import type {
  Summary, FunnelStage, AgentStat, MonthPoint, InventoryStats, ClientStats, OfferStats,
} from '@/lib/analytics'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

interface ClosedDeal { id: string; value: number; isRental: boolean; clientName: string; agentName: string; agentPct: number; companyPct: number; agentCommission: number; companyCommission: number }
interface Payload {
  scope: 'manager' | 'agent'
  summary: Summary
  funnel: FunnelStage[]
  monthly: MonthPoint[]
  mom: { wonThis: number; wonLast: number; valueThis: number; valueLast: number }
  avgDaysToClose: number | null
  inventory: InventoryStats
  clients: ClientStats
  offers: OfferStats
  leaderboard?: AgentStat[]
  closedDeals?: ClosedDeal[]
  ranks?: { revenue: { rank: number; of: number } | null; commission: { rank: number; of: number } | null }
}

function money(n: number) { return `$${Math.round(n).toLocaleString('en-US')}` }

function Delta({ now, prev, money: asMoney }: { now: number; prev: number; money?: boolean }) {
  const diff = now - prev
  if (diff === 0) return <span className="text-xs" style={{ color: SUB }}>Level with last month</span>
  const up = diff > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className="text-xs font-medium inline-flex items-center gap-0.5" style={{ color: up ? '#1F7A4D' : '#A23434' }}>
      <Icon className="h-3 w-3" />{asMoney ? formatPrice(Math.abs(diff)) : Math.abs(diff)} vs last month
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-4 md:p-5" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>{children}</div>
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-1.5" style={{ color: SUB }}>{icon}<span className="text-xs font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="text-2xl font-extrabold" style={{ color: H, letterSpacing: '-0.5px' }}>{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </Card>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold mb-2.5 mt-1" style={{ color: H }}>{children}</p>
}

export default function AnalyticsPage() {
  const { data, refresh } = useCachedFetch<Payload>('analytics', '/api/analytics')

  if (!data) return <div className="p-6 text-sm" style={{ color: SUB }}>Loading analytics…</div>

  const { summary: s, mom } = data
  const manager = data.scope === 'manager'
  const maxMonth = Math.max(1, ...data.monthly.map(m => m.wonValue))

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Analytics</h1>
        <p className="text-sm mt-0.5" style={{ color: SUB }}>
          {manager ? 'Your whole agency — revenue, commissions, and performance.' : 'Your performance this period.'}
        </p>
      </div>

      {/* Money KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="Revenue won" value={formatPrice(s.wonValue)}
          sub={<Delta now={mom.valueThis} prev={mom.valueLast} money />} />
        <Kpi icon={<Wallet className="h-4 w-4" />} label={manager ? 'Commission (agency)' : 'My commission'}
          value={money(manager ? s.totalCommission : s.agentCommission)}
          sub={manager ? <span className="text-xs" style={{ color: SUB }}>{money(s.agentCommission)} agents · {money(s.companyCommission)} company</span> : undefined} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Pipeline in play" value={formatPrice(s.openValue)}
          sub={<span className="text-xs" style={{ color: SUB }}>{s.open} open deals</span>} />
        <Kpi icon={<Percent className="h-4 w-4" />} label="Win rate" value={s.winRate == null ? '—' : `${s.winRate}%`}
          sub={<span className="text-xs" style={{ color: SUB }}>{s.won} won · {s.lost} lost{data.avgDaysToClose != null ? ` · ${data.avgDaysToClose}d avg` : ''}</span>} />
      </div>

      {/* Agent private rank */}
      {!manager && data.ranks && (data.ranks.revenue || data.ranks.commission) && (
        <div className="mt-3">
          <Card>
            <div className="flex items-center gap-2 mb-2" style={{ color: SUB }}><Trophy className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Where you rank</span></div>
            <div className="flex flex-wrap gap-6">
              {data.ranks.revenue && <div><p className="text-2xl font-extrabold" style={{ color: H }}>#{data.ranks.revenue.rank}<span className="text-sm font-semibold" style={{ color: SUB }}> of {data.ranks.revenue.of}</span></p><p className="text-xs" style={{ color: SUB }}>by revenue</p></div>}
              {data.ranks.commission && <div><p className="text-2xl font-extrabold" style={{ color: H }}>#{data.ranks.commission.rank}<span className="text-sm font-semibold" style={{ color: SUB }}> of {data.ranks.commission.of}</span></p><p className="text-xs" style={{ color: SUB }}>by commission</p></div>}
            </div>
            <p className="text-xs mt-2" style={{ color: '#9AA3B2' }}>Only your own position is shown — teammates&apos; numbers stay private.</p>
          </Card>
        </div>
      )}

      {/* Manager leaderboard */}
      {manager && data.leaderboard && data.leaderboard.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Agent leaderboard</SectionTitle>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 520 }}>
                <thead><tr style={{ color: SUB }}>
                  {['Agent', 'Won', 'Revenue', 'Commission', 'Open', 'Win %', 'Avg days'].map((h, i) => (
                    <th key={h} className={`py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.leaderboard.map((a, i) => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="py-2.5 font-semibold" style={{ color: H }}>
                        <span className="inline-block w-5 text-center mr-1.5" style={{ color: i < 3 ? '#8A5A12' : '#C4CAD6' }}>{i + 1}</span>{a.name}
                      </td>
                      <td className="py-2.5 text-right" style={{ color: H }}>{a.won}</td>
                      <td className="py-2.5 text-right font-semibold" style={{ color: H }}>{formatPrice(a.wonValue)}</td>
                      <td className="py-2.5 text-right font-bold" style={{ color: '#1F7A4D' }}>{money(a.commission)}</td>
                      <td className="py-2.5 text-right" style={{ color: SUB }}>{a.open}</td>
                      <td className="py-2.5 text-right" style={{ color: SUB }}>{a.winRate == null ? '—' : `${a.winRate}%`}</td>
                      <td className="py-2.5 text-right" style={{ color: SUB }}>{a.avgDaysToClose == null ? '—' : `${a.avgDaysToClose}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Pipeline funnel + monthly trend */}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div>
          <SectionTitle>Pipeline</SectionTitle>
          <Card>
            <div className="space-y-2">
              {data.funnel.map(f => (
                <div key={f.id}>
                  <div className="flex justify-between text-xs mb-0.5"><span style={{ color: H, fontWeight: 600 }}>{f.label}</span><span style={{ color: SUB }}>{f.count} · {formatPrice(f.value)}</span></div>
                  <div className="h-2 rounded-full" style={{ background: '#F0F2F5' }}><div className="h-2 rounded-full" style={{ width: `${f.pct}%`, background: '#5E8FD6' }} /></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div>
          <SectionTitle>Revenue closed — last 6 months</SectionTitle>
          <Card>
            <div className="flex items-end gap-2" style={{ height: 140 }}>
              {data.monthly.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <div className="w-full rounded-t" style={{ height: `${Math.max(4, (m.wonValue / maxMonth) * 110)}px`, background: m.wonValue ? '#1F7A4D' : '#E3E7EE' }} title={formatPrice(m.wonValue)} />
                  <span className="text-[10px]" style={{ color: SUB }}>{m.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Offers / inventory / clients */}
      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <div>
          <SectionTitle>Offers &amp; negotiation</SectionTitle>
          <Card>
            <p className="text-2xl font-extrabold" style={{ color: H }}>{data.offers.winRate == null ? '—' : `${data.offers.winRate}%`}</p>
            <p className="text-xs" style={{ color: SUB }}>accepted of decided negotiations</p>
            <div className="mt-3 text-xs space-y-1" style={{ color: SUB }}>
              <div className="flex justify-between"><span>Open</span><span style={{ color: H, fontWeight: 600 }}>{data.offers.open}</span></div>
              <div className="flex justify-between"><span>Accepted</span><span style={{ color: '#1F7A4D', fontWeight: 600 }}>{data.offers.accepted}</span></div>
              <div className="flex justify-between"><span>Rejected</span><span style={{ color: '#A23434', fontWeight: 600 }}>{data.offers.rejected}</span></div>
              {data.offers.avgAcceptedDiscount != null && <div className="flex justify-between"><span>Avg vs asking</span><span style={{ color: H, fontWeight: 600 }}>{data.offers.avgAcceptedDiscount > 0 ? `${data.offers.avgAcceptedDiscount}% below` : `${Math.abs(data.offers.avgAcceptedDiscount)}% above`}</span></div>}
            </div>
          </Card>
        </div>
        <div>
          <SectionTitle>Inventory</SectionTitle>
          <Card>
            <p className="text-2xl font-extrabold" style={{ color: H }}>{data.inventory.total}</p>
            <p className="text-xs" style={{ color: SUB }}>listings · {formatPrice(data.inventory.totalValue)} value</p>
            <div className="mt-3 text-xs space-y-1" style={{ color: SUB }}>
              <div className="flex justify-between"><span>Available</span><span style={{ color: H, fontWeight: 600 }}>{data.inventory.available}</span></div>
              <div className="flex justify-between"><span>Reserved</span><span style={{ color: H, fontWeight: 600 }}>{data.inventory.reserved}</span></div>
              <div className="flex justify-between"><span>Sold / rented</span><span style={{ color: H, fontWeight: 600 }}>{data.inventory.sold}</span></div>
              <div className="flex justify-between"><span>For sale / rent</span><span style={{ color: H, fontWeight: 600 }}>{data.inventory.forSale} / {data.inventory.forRent}</span></div>
            </div>
          </Card>
        </div>
        <div>
          <SectionTitle>Clients</SectionTitle>
          <Card>
            <p className="text-2xl font-extrabold" style={{ color: H }}>{data.clients.total}</p>
            <p className="text-xs" style={{ color: SUB }}>{data.clients.buyers} buyers · {data.clients.renters} renters</p>
            <div className="mt-3 text-xs space-y-1" style={{ color: SUB }}>
              <div className="flex justify-between"><span>🔥 Hot leads</span><span style={{ color: '#A23434', fontWeight: 600 }}>{data.clients.hot}</span></div>
              <div className="flex justify-between"><span>Warm</span><span style={{ color: '#9A6516', fontWeight: 600 }}>{data.clients.warm}</span></div>
              <div className="flex justify-between"><span>Cold</span><span style={{ color: SUB, fontWeight: 600 }}>{data.clients.cold}</span></div>
            </div>
          </Card>
        </div>
      </div>

      {/* Commission table (managers) — editable co-broker split */}
      {manager && data.closedDeals && data.closedDeals.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Closed deals &amp; commission</SectionTitle>
          <Card>
            <p className="text-xs mb-3" style={{ color: SUB }}>Sales: 2.5% agent / 2.5% company (adjust a row for a co-broker). Rentals: 1 month&apos;s rent each.</p>
            <CommissionTable rows={data.closedDeals} onSaved={refresh} />
          </Card>
        </div>
      )}
    </div>
  )
}

// ── Editable commission table ─────────────────────────────────────────────────
function CommissionTable({ rows, onSaved }: { rows: ClosedDeal[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [edit, setEdit] = useState<Record<string, { a: string; c: string }>>({})

  async function save(id: string, agentPct: number, companyPct: number) {
    setBusy(id)
    try {
      await fetch('/api/analytics', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId: id, agentPct, companyPct }) })
      await onSaved()
      setEdit(e => { const n = { ...e }; delete n[id]; return n })
    } finally { setBusy(null) }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 560 }}>
        <thead><tr style={{ color: SUB }}>
          {['Client', 'Agent', 'Value', 'Agent %', 'Company %', 'Commission', ''].map((h, i) => (
            <th key={h} className={`py-2 font-semibold ${i === 0 || i === 1 ? 'text-left' : 'text-right'}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const e = edit[r.id]
            const a = e ? e.a : String(r.agentPct)
            const c = e ? e.c : String(r.companyPct)
            const dirty = e && (Number(e.a) !== r.agentPct || Number(e.c) !== r.companyPct)
            return (
              <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="py-2 font-semibold" style={{ color: H }}>{r.clientName}</td>
                <td className="py-2" style={{ color: SUB }}>{r.agentName}</td>
                <td className="py-2 text-right" style={{ color: H }}>{r.isRental ? `${formatPrice(r.value)}/mo` : formatPrice(r.value)}</td>
                {r.isRental ? (
                  <td className="py-2 text-right text-xs" colSpan={2} style={{ color: SUB }}>Rental · 1 mo + 1 mo</td>
                ) : (
                  <>
                    <td className="py-2 text-right">
                      <input value={a} onChange={ev => setEdit(x => ({ ...x, [r.id]: { a: ev.target.value, c } }))} inputMode="decimal"
                        className="w-14 text-right rounded-md px-1.5 py-1" style={{ border: `1.5px solid ${dirty ? '#5E8FD6' : LINE}`, color: H }} />
                    </td>
                    <td className="py-2 text-right">
                      <input value={c} onChange={ev => setEdit(x => ({ ...x, [r.id]: { a, c: ev.target.value } }))} inputMode="decimal"
                        className="w-14 text-right rounded-md px-1.5 py-1" style={{ border: `1.5px solid ${dirty ? '#5E8FD6' : LINE}`, color: H }} />
                    </td>
                  </>
                )}
                <td className="py-2 text-right font-bold" style={{ color: '#1F7A4D' }}>{money(r.agentCommission + r.companyCommission)}</td>
                <td className="py-2 text-right">
                  {!r.isRental && dirty && <button onClick={() => save(r.id, Number(a), Number(c))} disabled={busy === r.id} className="text-xs font-bold px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>{busy === r.id ? '…' : 'Save'}</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
