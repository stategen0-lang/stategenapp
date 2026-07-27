'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp, DollarSign, Percent, Layers, ArrowUp, ArrowDown } from 'lucide-react'
import { formatPrice } from '@/lib/data'
import { findAgent, unknownAgent, type RosterAgent } from '@/lib/agent-roster'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import {
  summarise, funnel, leaderboard, monthlyClosed, monthOverMonth, avgDaysToClose,
  type AnalyticsDeal,
} from '@/lib/analytics'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

// The deals API returns everything these need; keep the fields we read explicit.
interface DealRow extends AnalyticsDeal {
  agent_id: string | null
}

// ── Month-over-month delta chip ───────────────────────────────────────────────
function Delta({ now, prev, unit = '' }: { now: number; prev: number; unit?: string }) {
  if (prev === 0 && now === 0) return <span className="text-xs" style={{ color: SUB }}>No change vs last month</span>
  const diff = now - prev
  if (diff === 0) return <span className="text-xs" style={{ color: SUB }}>Level with last month</span>
  const up = diff > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className="text-xs font-medium flex items-center gap-0.5" style={{ color: up ? '#1F7A4D' : '#A23434' }}>
      <Icon className="h-3 w-3" />
      {unit === '$' ? formatPrice(Math.abs(diff)) : Math.abs(diff)}{unit && unit !== '$' ? unit : ''} vs last month
    </span>
  )
}

export default function AnalyticsPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)

  const [deals, setDeals] = useState<DealRow[]>([])
  const [roster, setRoster] = useState<RosterAgent[]>([])
  const [loading, setLoading] = useState(true)

  // URL-backed agent filter, matching the pipeline and calendar.
  const [agentFilter, setAgentFilter] = useState('')
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('agent') ?? ''
    if (fromUrl) setAgentFilter(fromUrl)
  }, [])
  function selectAgent(id: string) {
    setAgentFilter(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('agent', id); else url.searchParams.delete('agent')
    window.history.replaceState(null, '', url)
  }

  const requestId = useRef(0)
  const load = useCallback(async () => {
    const id = ++requestId.current
    const url = agentFilter ? `/api/deals?agent=${encodeURIComponent(agentFilter)}` : '/api/deals'
    try {
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (id !== requestId.current) return
        if (Array.isArray(data.deals)) setDeals(data.deals)
        if (Array.isArray(data.agents)) setRoster(data.agents)
      }
    } catch { /* keep what's on screen */ }
    if (id === requestId.current) setLoading(false)
  }, [agentFilter])
  useEffect(() => { load() }, [load])

  const s = useMemo(() => summarise(deals), [deals])
  const stages = useMemo(() => funnel(deals), [deals])
  const board = useMemo(() => leaderboard(deals, roster.map(a => ({ id: a.id, name: a.name }))), [deals, roster])
  const months = useMemo(() => monthlyClosed(deals), [deals])
  const mom = useMemo(() => monthOverMonth(deals), [deals])
  const avgDays = useMemo(() => avgDaysToClose(deals), [deals])

  const agentOf = (id: string | null) => findAgent(roster, id) ?? unknownAgent(id)
  const maxStage = Math.max(...stages.map(x => x.count), 1)
  const maxWon = Math.max(...board.map(a => a.wonValue), 1)
  const maxMonth = Math.max(...months.map(m => m.wonValue), 1)

  const kpis = [
    {
      label: 'Closed won', value: String(s.won),
      icon: TrendingUp, bg: '#EAF0FA', fg: '#2E5288',
      delta: <Delta now={mom.wonThis} prev={mom.wonLast} />,
    },
    {
      label: 'Closed value', value: formatPrice(s.wonValue),
      icon: DollarSign, bg: '#E3F4EA', fg: '#1F8A5B',
      delta: <Delta now={mom.valueThis} prev={mom.valueLast} unit="$" />,
    },
    {
      label: 'Win rate', value: s.winRate === null ? '—' : `${s.winRate}%`,
      icon: Percent, bg: '#FBEFD6', fg: '#9A6516',
      delta: <span className="text-xs" style={{ color: SUB }}>{s.won} won · {s.lost} lost</span>,
    },
    {
      label: 'Open pipeline', value: formatPrice(s.openValue),
      icon: Layers, bg: '#FBE7E7', fg: '#A23434',
      delta: <span className="text-xs" style={{ color: SUB }}>{s.open} active deal{s.open === 1 ? '' : 's'}</span>,
    },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Reports</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: SUB }}>
            {loading
              ? 'Loading…'
              : manager
                ? `Live figures${agentFilter ? ` · ${agentOf(agentFilter).name}` : ' · whole agency'}${avgDays !== null ? ` · avg ${avgDays}d to close` : ''}`
                : `Your performance${avgDays !== null ? ` · avg ${avgDays}d to close` : ''}`}
          </p>
        </div>
        {manager && (
          <select
            value={agentFilter}
            onChange={e => selectAgent(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm font-semibold outline-none"
            style={{ border: `1.5px solid ${LINE}`, background: '#F7F8FB', color: H }}
            aria-label="Filter reports by agent"
          >
            <option value="">All agents</option>
            {roster.map(a => <option key={a.id} value={a.id}>{a.orphan ? `${a.name} — no profile` : a.name}</option>)}
          </select>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {kpis.map(({ label, value, icon: Icon, bg, fg, delta }) => (
          <div key={label} className="rounded-2xl p-5 bg-white" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${LINE}` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: bg }}>
              <Icon className="h-5 w-5" style={{ color: fg }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>{loading ? '—' : value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: SUB }}>{label}</p>
            <div className="mt-1.5">{!loading && delta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        {/* Pipeline funnel */}
        <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${LINE}` }}>
          <h2 className="text-sm font-bold mb-1" style={{ color: H }}>Pipeline by stage</h2>
          <p className="text-xs mb-4" style={{ color: SUB }}>Where the {s.total} deal{s.total === 1 ? '' : 's'} sit right now</p>
          <div className="space-y-3">
            {stages.map(st => (
              <div key={st.id}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span style={{ color: H, fontWeight: 600 }}>{st.label}</span>
                  <span style={{ color: SUB }}>{st.count} · {formatPrice(st.value)}</span>
                </div>
                <div className="h-2.5 rounded-full" style={{ background: '#EEF0F4' }}>
                  <div className="h-2.5 rounded-full transition-all" style={{ width: `${(st.count / maxStage) * 100}%`, background: '#5E8FD6' }} />
                </div>
              </div>
            ))}
            {!loading && s.total === 0 && <p className="text-xs text-center py-4" style={{ color: SUB }}>No deals yet.</p>}
          </div>
        </div>

        {/* Monthly closed trend */}
        <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${LINE}` }}>
          <h2 className="text-sm font-bold mb-1" style={{ color: H }}>Closed deals — last 6 months</h2>
          <p className="text-xs mb-4" style={{ color: SUB }}>Won deals by the month they closed</p>
          <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
            {months.map(m => (
              <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1.5" style={{ height: '100%' }}>
                <span className="text-xs font-bold" style={{ color: m.wonCount ? H : '#C4CAD6' }}>{m.wonCount || ''}</span>
                <div
                  className="w-full rounded-t-md transition-all"
                  title={`${m.label}: ${m.wonCount} won · ${formatPrice(m.wonValue)}`}
                  style={{
                    height: `${Math.max((m.wonValue / maxMonth) * 100, m.wonCount ? 4 : 0)}%`,
                    minHeight: m.wonCount ? 6 : 0,
                    background: '#1F8A5B',
                  }}
                />
                <span className="text-xs" style={{ color: SUB }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Agent leaderboard */}
      <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${LINE}` }}>
        <h2 className="text-sm font-bold mb-1" style={{ color: H }}>{manager ? 'Agent leaderboard' : 'Your performance'}</h2>
        <p className="text-xs mb-4" style={{ color: SUB }}>Ranked by closed value; open pipeline breaks a tie</p>
        <div className="space-y-3">
          {board.map((a, i) => {
            const agent = agentOf(a.id)
            return (
              <div key={a.id} className="rounded-xl p-3" style={{ border: `1.5px solid ${LINE}` }}>
                <div className="flex items-center gap-2.5 mb-2">
                  {manager && <span className="text-xs font-bold w-4 shrink-0" style={{ color: SUB }}>{i + 1}</span>}
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: agent.color }}>{agent.initials}</div>
                  <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: H }}>{a.name}</span>
                  <span className="text-sm font-bold shrink-0" style={{ color: '#1F7A4D' }}>{formatPrice(a.wonValue)}</span>
                </div>
                <div className="h-2 rounded-full mb-2" style={{ background: '#EEF0F4' }}>
                  <div className="h-2 rounded-full transition-all" style={{ width: `${(a.wonValue / maxWon) * 100}%`, background: agent.color }} />
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: SUB }}>
                  <span><b style={{ color: H }}>{a.won}</b> won</span>
                  <span><b style={{ color: H }}>{a.lost}</b> lost</span>
                  <span><b style={{ color: H }}>{a.open}</b> open · {formatPrice(a.openValue)}</span>
                  <span>win rate <b style={{ color: H }}>{a.winRate === null ? '—' : `${a.winRate}%`}</b></span>
                </div>
              </div>
            )
          })}
          {!loading && board.length === 0 && <p className="text-xs text-center py-4" style={{ color: SUB }}>No agents to show.</p>}
        </div>
      </div>
    </div>
  )
}
