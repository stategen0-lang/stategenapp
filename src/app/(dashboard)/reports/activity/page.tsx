'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import {
  ACTIVITY_ICON, ACTIVITY_LABEL, activityAgo,
  type ActivityItem, type ActivityKind, type AgentActivitySummary,
} from '@/lib/activity'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

// The action types shown in the report (client_referred isn't timestamped yet).
const REPORT_KINDS: ActivityKind[] = [
  'listing_added', 'client_added', 'deal_moved', 'deal_won', 'deal_lost', 'offer_logged', 'event_scheduled',
]

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d }
function startOfMonth(): Date { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) }

interface Payload { from: string; to: string; items: ActivityItem[]; byAgent: AgentActivitySummary[]; agents: { code: string; name: string }[] }

export default function AgentReportPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)

  const [fromDate, setFromDate] = useState(ymd(daysAgo(7)))
  const [toDate, setToDate] = useState(ymd(new Date()))
  const [agent, setAgent] = useState('')   // '' = all agents
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [preset, setPreset] = useState<string>('7d')

  const load = useCallback(async () => {
    setLoading(true)
    // Cover whole local days: from 00:00 of the start to 23:59:59 of the end.
    const fromISO = new Date(`${fromDate}T00:00:00`).toISOString()
    const toISO = new Date(`${toDate}T23:59:59.999`).toISOString()
    const q = new URLSearchParams({ from: fromISO, to: toISO })
    if (agent) q.set('agent', agent)
    try {
      const r = await fetch(`/api/reports/activity?${q.toString()}`)
      if (r.ok) setData(await r.json())
    } catch { /* keep last */ }
    setLoading(false)
  }, [fromDate, toDate, agent])

  useEffect(() => { if (manager) load() }, [manager, load])

  function applyPreset(id: string) {
    setPreset(id)
    const today = ymd(new Date())
    if (id === 'today') { setFromDate(today); setToDate(today) }
    else if (id === '7d') { setFromDate(ymd(daysAgo(7))); setToDate(today) }
    else if (id === '30d') { setFromDate(ymd(daysAgo(30))); setToDate(today) }
    else if (id === 'month') { setFromDate(ymd(startOfMonth())); setToDate(today) }
  }

  const inputStyle = { border: `1.5px solid ${LINE}`, background: '#fff', color: H }
  const items = data?.items ?? []
  const byAgent = data?.byAgent ?? []

  // Which count columns actually occur in this window (keep the table tight).
  const activeKinds = useMemo(
    () => REPORT_KINDS.filter(k => byAgent.some(a => a.counts[k] > 0)),
    [byAgent],
  )

  if (session && !manager) {
    return (
      <div className="p-6">
        <p className="text-sm font-semibold" style={{ color: H }}>Managers only</p>
        <p className="text-xs mt-1" style={{ color: SUB }}>This report shows every agent&apos;s activity, so it&apos;s limited to managers.</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <Link href="/analytics" className="inline-flex items-center gap-1 text-xs font-semibold mb-3" style={{ color: '#2E5288' }}>
        <ChevronLeft className="h-3.5 w-3.5" /> Reports
      </Link>
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-5 w-5" style={{ color: H }} />
        <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Agent activity log</h1>
      </div>
      <p className="text-xs md:text-sm mb-4" style={{ color: SUB }}>Everything each agent did in the chosen period — listings, clients, deal moves, offers and viewings.</p>

      {/* Controls */}
      <div className="rounded-2xl p-4 mb-4" style={{ border: `1px solid ${LINE}`, background: '#fff' }}>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']].map(([id, label]) => (
            <button key={id} onClick={() => applyPreset(id)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full"
              style={preset === id ? { background: '#0E1F3D', color: '#fff' } : { background: '#F2F4F7', color: SUB }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: SUB }}>From</label>
            <input type="date" value={fromDate} max={toDate} onChange={e => { setFromDate(e.target.value); setPreset('custom') }}
              className="rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: SUB }}>To</label>
            <input type="date" value={toDate} min={fromDate} max={ymd(new Date())} onChange={e => { setToDate(e.target.value); setPreset('custom') }}
              className="rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-semibold block mb-1" style={{ color: SUB }}>Agent</label>
            <select value={agent} onChange={e => setAgent(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle}>
              <option value="">All agents</option>
              {(data?.agents ?? []).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && <p className="text-sm" style={{ color: SUB }}>Loading…</p>}

      {!loading && (
        <>
          {/* Per-agent scoreboard */}
          <p className="text-sm font-bold mb-2" style={{ color: H }}>Per agent</p>
          {byAgent.length === 0 ? (
            <div className="rounded-2xl p-8 text-center mb-5" style={{ border: `1.5px dashed ${LINE}` }}>
              <p className="text-sm font-semibold" style={{ color: H }}>No activity in this period</p>
              <p className="text-xs mt-1" style={{ color: SUB }}>Try a wider date range.</p>
            </div>
          ) : (
            <div className="overflow-x-auto mb-6 rounded-2xl" style={{ border: `1px solid ${LINE}` }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr style={{ background: '#F7F8FB' }}>
                    <th className="text-left font-semibold px-3 py-2.5" style={{ color: SUB }}>Agent</th>
                    <th className="text-center font-semibold px-2 py-2.5" style={{ color: SUB }}>Total</th>
                    {activeKinds.map(k => (
                      <th key={k} className="text-center font-semibold px-2 py-2.5" style={{ color: SUB, whiteSpace: 'nowrap' }} title={ACTIVITY_LABEL[k]}>
                        {ACTIVITY_ICON[k]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byAgent.map(a => (
                    <tr key={a.agentCode ?? '—'} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="px-3 py-2.5 font-semibold" style={{ color: H }}>{a.agentName}</td>
                      <td className="px-2 py-2.5 text-center font-extrabold" style={{ color: '#2E5288' }}>{a.total}</td>
                      {activeKinds.map(k => (
                        <td key={k} className="px-2 py-2.5 text-center" style={{ color: a.counts[k] ? H : '#C4CAD6' }}>
                          {a.counts[k] || '·'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          {activeKinds.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-6">
              {activeKinds.map(k => (
                <span key={k} className="text-xs" style={{ color: SUB }}>{ACTIVITY_ICON[k]} {ACTIVITY_LABEL[k]}</span>
              ))}
            </div>
          )}

          {/* Detailed timeline */}
          {items.length > 0 && (
            <>
              <p className="text-sm font-bold mb-2" style={{ color: H }}>Timeline <span style={{ color: SUB, fontWeight: 400 }}>({items.length})</span></p>
              <div className="space-y-1.5">
                {items.map(it => (
                  <div key={it.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ border: `1px solid ${LINE}`, background: '#fff' }}>
                    <span className="text-base leading-none pt-0.5">{ACTIVITY_ICON[it.kind]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: H }}>{it.summary}</p>
                      <p className="text-xs mt-0.5" style={{ color: SUB }}>
                        {it.agentName ?? it.agentCode ?? 'Unassigned'}{it.detail ? ` · ${it.detail}` : ''}
                      </p>
                    </div>
                    <span className="text-xs shrink-0" style={{ color: '#9AA3B2' }} title={new Date(it.at).toLocaleString()}>
                      {activityAgo(it.at)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
