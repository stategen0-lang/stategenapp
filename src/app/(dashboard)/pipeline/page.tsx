'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/data'
import { findAgent, unknownAgent, type RosterAgent } from '@/lib/agent-roster'
import {
  Deal, Stage, STAGES, dealsInStage, totalValue, sortForBoard,
  daysInStage, staleFlag, STALE_STYLE, isStage,
} from '@/lib/pipeline'
import { scoreBand, BAND_STYLE } from '@/lib/scoring'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

const H = '#14223F'
const SUB = '#6A7488'

// Resolve against the live roster. Never falls back to "the first agent" —
// that silently displayed one agent's deals under another's name and colour.
function agentOf(roster: RosterAgent[], id: string | null) {
  return findAgent(roster, id) ?? unknownAgent(id)
}

// ── Deal card ────────────────────────────────────────────────────────────────
function DealCard({
  deal, roster, onMove, onOutcome, dragging, setDragging,
}: {
  deal: Deal
  roster: RosterAgent[]
  onMove: (id: string, stage: Stage) => void
  onOutcome: (id: string, outcome: 'won' | 'lost') => void
  dragging: string | null
  setDragging: (id: string | null) => void
}) {
  const agent = agentOf(roster, deal.agent_id)
  const days = daysInStage(deal.stage_changed_at)
  const flag = staleFlag(days)
  const st = STALE_STYLE[flag]
  const band = BAND_STYLE[scoreBand(deal.leadScore)]
  const isDragging = dragging === deal.id

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', deal.id); setDragging(deal.id) }}
      onDragEnd={() => setDragging(null)}
      className="rounded-xl p-3 mb-2 bg-white cursor-grab active:cursor-grabbing transition-opacity"
      style={{
        border: '1px solid #EEF0F4',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        opacity: isDragging ? 0.45 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight" style={{ color: H }}>{deal.clientName}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Lead score badge — color by band (hot/warm/cold), number always shown */}
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: band.bg, color: band.color }}
            title={`Lead score ${deal.leadScore}/100`}
          >
            {deal.leadScore}
          </span>
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: agent.color }}
            title={agent.name}
          >
            {agent.initials}
          </div>
        </div>
      </div>

      {deal.propertyLabel && (
        <p className="text-xs mt-1 truncate" style={{ color: SUB }}>{deal.propertyLabel}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-sm font-bold" style={{ color: H }}>{formatPrice(deal.value)}</p>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
          {days}d in stage
        </span>
      </div>

      {/* Won / Lost picker for closed deals with no outcome yet */}
      {deal.stage === 'closed' && !deal.outcome && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => onOutcome(deal.id, 'won')}
            className="flex-1 text-[11px] font-bold py-1 rounded-lg" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>
            Won
          </button>
          <button onClick={() => onOutcome(deal.id, 'lost')}
            className="flex-1 text-[11px] font-bold py-1 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>
            Lost
          </button>
        </div>
      )}

      {/* Touch-friendly stage move (drag-and-drop is desktop-only) */}
      <select
        value={deal.stage}
        onChange={e => isStage(e.target.value) && onMove(deal.id, e.target.value)}
        className="md:hidden w-full mt-2 rounded-lg px-2 py-1.5 text-xs font-medium outline-none"
        style={{ border: '1px solid #EEF0F4', background: '#F7F8FB', color: H }}
        aria-label={`Move ${deal.clientName} to another stage`}
      >
        {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  )
}

// ── Board ────────────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [dragOver, setDragOver] = useState<Stage | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const { session } = useSession()
  const manager = isManager(session?.role)
  const [roster, setRoster] = useState<RosterAgent[]>([])

  // Kept in the URL so a filtered board survives a refresh and can be shared —
  // "look at Rami's pipeline" is a link, not a set of instructions.
  const [agentFilter, setAgentFilter] = useState<string>('')
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('agent') ?? ''
    if (fromUrl) setAgentFilter(fromUrl)
  }, [])

  function selectAgent(id: string) {
    setAgentFilter(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('agent', id)
    else url.searchParams.delete('agent')
    window.history.replaceState(null, '', url)
  }

  // Guards against a slower earlier request landing after a newer one. Reading
  // ?agent= from the URL starts an unfiltered fetch and a filtered one in the
  // same tick; the unfiltered response is larger, so it arrived last and
  // repainted the board with every agent's deals under one agent's heading.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const url = agentFilter ? `/api/deals?agent=${encodeURIComponent(agentFilter)}` : '/api/deals'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (id !== requestId.current) return   // superseded — discard
        if (Array.isArray(data.deals)) setDeals(data.deals)
        // Sent unfiltered by the server, so narrowing to one agent never
        // shrinks the roster and strands you on that agent.
        if (Array.isArray(data.agents)) setRoster(data.agents)
      }
    } catch { /* leave the board as-is */ }
    if (id === requestId.current) setLoading(false)
  }, [agentFilter])

  useEffect(() => { load() }, [load])

  // Nightly-decay substitute: ask the server to refresh scores if they are
  // older than 12h; the realtime subscription re-syncs the board afterwards.
  useEffect(() => {
    fetch('/api/scores?staleOnly=1', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.updated > 0) load() })
      .catch(() => {})
  }, [load])

  // Live updates across agents (spec Part 1 — realtime subscription).
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('deals-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // Optimistic move, then persist; revert if the write fails.
  async function move(id: string, stage: Stage) {
    const before = deals
    const current = deals.find(d => d.id === id)
    if (!current || current.stage === stage) return
    setDeals(ds => ds.map(d => d.id === id
      ? { ...d, stage, outcome: stage === 'closed' ? d.outcome : null, stage_changed_at: new Date().toISOString() }
      : d))
    try {
      const res = await fetch('/api/deals', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, stage }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setDeals(before)
      showToast('Could not move deal — reverted')
    }
  }

  async function setOutcome(id: string, outcome: 'won' | 'lost') {
    const before = deals
    setDeals(ds => ds.map(d => d.id === id ? { ...d, outcome } : d))
    try {
      const res = await fetch('/api/deals', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, outcome }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setDeals(before)
      showToast('Could not set outcome — reverted')
    }
  }

  return (
    <div className="p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Pipeline</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: SUB }}>
            {loading
              ? 'Loading deals…'
              : manager
                ? `${deals.length} deals${agentFilter ? ` · ${agentOf(roster, agentFilter).name}` : ' · whole agency'}`
                : `${deals.length} of your deals · drag a card to move it between stages`}
          </p>
        </div>

        {/* Managers can narrow the whole board to one agent */}
        {manager && (
          <select
            value={agentFilter}
            onChange={e => selectAgent(e.target.value)}
            className="rounded-xl px-3 py-2 text-sm font-semibold outline-none"
            style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: H }}
            aria-label="Filter pipeline by agent"
          >
            <option value="">All agents</option>
            {roster.map(a => (
              <option key={a.id} value={a.id}>{a.orphan ? `${a.name} — no profile` : a.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* One agent's headline numbers. The reason to isolate an agent is to see
          how they're doing, which the board alone doesn't answer. */}
      {manager && agentFilter && !loading && (() => {
        const agent = agentOf(roster, agentFilter)
        const closed = deals.filter(d => d.stage === 'closed')
        const won = closed.filter(d => d.outcome === 'won')
        const lost = closed.filter(d => d.outcome === 'lost')
        const open = deals.filter(d => d.stage !== 'closed')
        const stale = deals.filter(d => staleFlag(daysInStage(d.stage_changed_at)) === 'late')
        const decided = won.length + lost.length

        const stat = (label: string, value: string, color = H) => (
          <div key={label} className="px-3 py-2">
            <p className="text-[11px] font-medium" style={{ color: SUB }}>{label}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color }}>{value}</p>
          </div>
        )

        return (
          <div
            className="mb-4 rounded-xl flex flex-wrap items-center gap-1 divide-x"
            style={{ border: '1.5px solid #EEF0F4', background: '#FBFCFE' }}
          >
            <div className="px-3 py-2 flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                style={{ background: agent.color }}
              >
                {agent.initials}
              </div>
              <p className="text-sm font-bold" style={{ color: H }}>{agent.name}</p>
            </div>
            {stat('Open deals', String(open.length))}
            {stat('Open value', formatPrice(totalValue(open)))}
            {stat('Won', String(won.length), '#1F7A4D')}
            {stat('Lost', String(lost.length), '#A23434')}
            {stat('Win rate', decided ? `${Math.round((won.length / decided) * 100)}%` : '—')}
            {stat('Stalled >14d', String(stale.length), stale.length ? '#A23434' : H)}
          </div>
        )
      })()}

      {/* Columns — horizontal scroll on mobile, 5-up on desktop */}
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0">
        {STAGES.map(stage => {
          const inStage = sortForBoard(dealsInStage(deals, stage.id))
          const isOver = dragOver === stage.id
          const won = inStage.filter(d => d.outcome === 'won')
          const lost = inStage.filter(d => d.outcome === 'lost')
          const undecided = inStage.filter(d => !d.outcome)

          return (
            <div
              key={stage.id}
              onDragOver={e => { e.preventDefault(); setDragOver(stage.id) }}
              onDragLeave={() => setDragOver(prev => prev === stage.id ? null : prev)}
              onDrop={e => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                setDragOver(null); setDragging(null)
                if (id) move(id, stage.id)
              }}
              className="shrink-0 w-[264px] md:flex-1 md:w-auto rounded-2xl p-2.5 transition-colors"
              style={{
                background: isOver ? '#EAF0FA' : '#F7F8FB',
                border: isOver ? '1.5px dashed #5E8FD6' : '1.5px solid #EEF0F4',
                minHeight: 220,
              }}
            >
              {/* Column header — count + total value */}
              <div className="px-1 pb-2 mb-1" style={{ borderBottom: '1px solid #EEF0F4' }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: H }}>{stage.label}</p>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                    {inStage.length}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 font-semibold" style={{ color: SUB }}>
                  {formatPrice(totalValue(inStage))}
                </p>
              </div>

              {stage.id !== 'closed' && inStage.map(d => (
                <DealCard key={d.id} deal={d} roster={roster} onMove={move} onOutcome={setOutcome} dragging={dragging} setDragging={setDragging} />
              ))}

              {/* Closed splits into Won / Lost */}
              {stage.id === 'closed' && (
                <>
                  {undecided.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold mt-1 mb-1 px-1" style={{ color: '#9A6516' }}>OUTCOME?</p>
                      {undecided.map(d => (
                        <DealCard key={d.id} deal={d} roster={roster} onMove={move} onOutcome={setOutcome} dragging={dragging} setDragging={setDragging} />
                      ))}
                    </>
                  )}
                  {won.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold mt-1 mb-1 px-1" style={{ color: '#1F7A4D' }}>WON · {formatPrice(totalValue(won))}</p>
                      {won.map(d => (
                        <DealCard key={d.id} deal={d} roster={roster} onMove={move} onOutcome={setOutcome} dragging={dragging} setDragging={setDragging} />
                      ))}
                    </>
                  )}
                  {lost.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold mt-1 mb-1 px-1" style={{ color: '#A23434' }}>LOST · {formatPrice(totalValue(lost))}</p>
                      {lost.map(d => (
                        <DealCard key={d.id} deal={d} roster={roster} onMove={move} onOutcome={setOutcome} dragging={dragging} setDragging={setDragging} />
                      ))}
                    </>
                  )}
                </>
              )}

              {!loading && inStage.length === 0 && (
                <p className="text-[11px] text-center py-6" style={{ color: '#9AA3B2' }}>No deals</p>
              )}
            </div>
          )
        })}
      </div>

      {toast && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 px-4 py-2.5 rounded-xl text-sm font-semibold text-white z-50"
          style={{ background: '#A23434', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
