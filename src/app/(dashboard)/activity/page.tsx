'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity as ActivityIcon, Search, X } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import { isManager } from '@/lib/permissions'
import {
  ACTIVITY_ICON, ACTIVITY_LABEL, activityAgo, activityHref,
  filterActivity, kindsPresent, agentsPresent, digestActivity, activityByDay,
  type ActivityItem, type ActivityKind,
} from '@/lib/activity'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'
const ACCENT = '#2E5288'

const KIND_BG: Record<ActivityKind, string> = {
  listing_added: '#EAF0FA',
  client_added: '#EDEAFA',
  deal_moved: '#FBF0DA',
  deal_won: '#E3F4EA',
  deal_lost: '#FBE7E7',
  offer_logged: '#FBF0DA',
  event_scheduled: '#EAF0FA',
  client_referred: '#EDEAFA',
  price_changed: '#FBF0DA',
  status_changed: '#E3F4EA',
}

// Short chip labels — "Listings added" is a report heading, not a filter chip.
const CHIP_LABEL: Partial<Record<ActivityKind, string>> = {
  listing_added: 'Listings', client_added: 'Clients', deal_moved: 'Deals',
  deal_won: 'Won', deal_lost: 'Lost', offer_logged: 'Offers',
  event_scheduled: 'Viewings', client_referred: 'Referrals',
  price_changed: 'Price', status_changed: 'Status',
}

const PERIODS = [
  { key: 'all', label: 'All', days: 0 },
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: '7 days', days: 7 },
  { key: 'month', label: '30 days', days: 30 },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

const PAGE = 25
// Where the feed had got to last time, so "new since you looked" means
// something. Per device on purpose: it is a reading position, not a fact about
// the agency, and it must never block the page if storage is unavailable.
const SEEN_KEY = 'activity:lastSeen'

function readLastSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY) } catch { return null }
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isSame = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yest = new Date(today); yest.setDate(today.getDate() - 1)
  if (isSame(d, today)) return 'Today'
  if (isSame(d, yest)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function ActivityPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)
  const { data } = useCachedFetch<{ items?: ActivityItem[] }>('activity', '/api/activity')
  const items: ActivityItem[] | null = data ? (Array.isArray(data.items) ? data.items : []) : null

  const [kinds, setKinds] = useState<ActivityKind[]>([])
  const [agent, setAgent] = useState<string>('')
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  // Read once on mount, before the visit is recorded — otherwise the marker
  // would always sit at the very top.
  const [lastSeen] = useState<string | null>(() => (typeof window === 'undefined' ? null : readLastSeen()))
  useEffect(() => {
    if (!items?.length) return
    try { localStorage.setItem(SEEN_KEY, items[0].at) } catch { /* private window */ }
  }, [items])

  const all = useMemo(() => items ?? [], [items])
  const digest = useMemo(() => digestActivity(all, 7), [all])
  const days = useMemo(() => activityByDay(all, 14), [all])
  const availableKinds = useMemo(() => kindsPresent(all), [all])
  const agents = useMemo(() => agentsPresent(all), [all])

  const filtered = useMemo(() => {
    const days = PERIODS.find(p => p.key === period)?.days ?? 0
    const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null
    return filterActivity(all, { kinds, agentCode: agent || null, from, query: q })
  }, [all, kinds, agent, period, q])

  useEffect(() => { setShown(PAGE) }, [kinds, agent, period, q])

  const toggleKind = (k: ActivityKind) =>
    setKinds(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]))

  const visible = filtered.slice(0, shown)
  const hidden = filtered.length - visible.length
  const filtering = kinds.length > 0 || !!agent || period !== 'all' || !!q.trim()
  const newCount = lastSeen ? all.filter(i => i.at > lastSeen).length : 0

  // Day headings, and the "new since you looked" rule drawn once.
  const groups: { label: string; items: ActivityItem[] }[] = []
  for (const it of visible) {
    const label = dayLabel(it.at)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(it)
    else groups.push({ label, items: [it] })
  }
  const firstOldId = lastSeen ? visible.find(i => i.at <= lastSeen)?.id : undefined

  const peak = Math.max(1, ...days.map(d => d.count))

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="mb-4">
        <div className="flex items-center gap-2.5">
          <ActivityIcon className="h-6 w-6" style={{ color: ACCENT }} />
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Activity</h1>
          {newCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#E3F4EA', color: '#1D7A4D' }}>
              {newCount} new
            </span>
          )}
        </div>
        <p className="text-sm mt-0.5" style={{ color: SUB }}>
          {manager ? 'Everything your team has done — new listings, clients, price moves and deals.'
                   : 'Your listings, clients, price moves and deals.'}
        </p>
      </div>

      {/* ── The week at a glance ── */}
      {all.length > 0 && (
        <div className="rounded-2xl bg-white p-4 mb-4" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold" style={{ color: H }}>{digest.total}</p>
            <p className="text-sm" style={{ color: SUB }}>in the last 7 days</p>
            {digest.changePct !== null && (
              <span className="text-xs font-bold ml-auto" style={{ color: digest.changePct >= 0 ? '#1D9E75' : '#BA7517' }}>
                {digest.changePct >= 0 ? '↑' : '↓'} {Math.abs(digest.changePct)}% vs the week before
              </span>
            )}
          </div>

          {/* Kind breakdown, only the ones that happened. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {(Object.keys(ACTIVITY_LABEL) as ActivityKind[])
              .filter(k => digest.counts[k] > 0)
              .map(k => (
                <span key={k} className="text-xs" style={{ color: SUB }}>
                  {ACTIVITY_ICON[k]} <b style={{ color: H }}>{digest.counts[k]}</b> {CHIP_LABEL[k] ?? k}
                </span>
              ))}
          </div>

          {/* Fourteen days, tallest bar = busiest day. */}
          <div className="flex items-end gap-1 mt-3" style={{ height: 34 }}>
            {days.map(d => (
              <div
                key={d.date}
                title={`${d.count} on ${new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(4, (d.count / peak) * 100)}%`,
                  background: d.count ? ACCENT : '#EEF0F4',
                  opacity: d.count ? 0.35 + (d.count / peak) * 0.65 : 1,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      {all.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9AA3B2' }} />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search the feed…"
                className="w-full rounded-xl pl-9 pr-3 py-2 text-sm outline-none"
                style={{ border: `1.5px solid ${LINE}`, background: '#F7F8FB', color: H }}
              />
            </div>
            {manager && agents.length > 1 && (
              <select
                value={agent}
                onChange={e => setAgent(e.target.value)}
                className="rounded-xl px-3 py-2 text-sm outline-none"
                style={{ border: `1.5px solid ${LINE}`, background: '#F7F8FB', color: H, maxWidth: 150 }}
              >
                <option value="">All agents</option>
                {agents.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
              </select>
            )}
          </div>

          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                style={period === p.key
                  ? { background: ACCENT, color: '#fff' }
                  : { background: '#F7F8FB', color: SUB, border: `1px solid ${LINE}` }}
              >
                {p.label}
              </button>
            ))}
            <span className="shrink-0 w-px my-1" style={{ background: LINE }} />
            {availableKinds.map(k => (
              <button
                key={k}
                onClick={() => toggleKind(k)}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                style={kinds.includes(k)
                  ? { background: ACCENT, color: '#fff' }
                  : { background: KIND_BG[k], color: H }}
              >
                {ACTIVITY_ICON[k]} {CHIP_LABEL[k] ?? k}
              </button>
            ))}
          </div>

          {filtering && (
            <button
              onClick={() => { setKinds([]); setAgent(''); setPeriod('all'); setQ('') }}
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: ACCENT }}
            >
              <X className="h-3 w-3" /> Clear filters · {filtered.length} of {all.length}
            </button>
          )}
        </div>
      )}

      {items === null ? (
        <p className="text-sm py-10 text-center" style={{ color: SUB }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ border: `1.5px dashed ${LINE}` }}>
          <ActivityIcon className="h-6 w-6 mx-auto mb-2" style={{ color: '#C4CAD6' }} />
          <p className="text-sm font-semibold" style={{ color: H }}>{filtering ? 'Nothing matches' : 'Nothing yet'}</p>
          <p className="text-xs mt-1" style={{ color: SUB }}>
            {filtering ? 'Try a wider period, or clear the filters.' : 'New listings, clients, and deal moves will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label}>
              <p className="text-xs font-bold uppercase mb-2.5" style={{ color: '#9AA3B2', letterSpacing: '0.06em' }}>{group.label}</p>
              <div className="rounded-2xl bg-white overflow-hidden" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="divide-y" style={{ borderColor: LINE }}>
                  {group.items.map(it => {
                    const href = activityHref(it.target)
                    const row = (
                      <>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: KIND_BG[it.kind] }}>
                          {ACTIVITY_ICON[it.kind]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: H }}>{it.summary}</p>
                          <p className="text-xs truncate" style={{ color: SUB }}>
                            {[it.detail, manager ? it.agentName : null].filter(Boolean).join(' · ') || ' '}
                          </p>
                        </div>
                        <span className="text-xs shrink-0" style={{ color: '#9AA3B2' }}>{activityAgo(it.at)}</span>
                      </>
                    )
                    return (
                      <div key={it.id}>
                        {/* Where the last visit ended. */}
                        {it.id === firstOldId && newCount > 0 && (
                          <div className="flex items-center gap-2 px-3.5 py-1" style={{ background: '#FAFBFD' }}>
                            <span className="h-px flex-1" style={{ background: '#D8E2F2' }} />
                            <span className="text-[10px] font-bold uppercase" style={{ color: '#7A93C0', letterSpacing: '0.08em' }}>Seen before</span>
                            <span className="h-px flex-1" style={{ background: '#D8E2F2' }} />
                          </div>
                        )}
                        {href ? (
                          <Link href={href} className="flex items-center gap-3 p-3.5 transition-colors hover:bg-gray-50">{row}</Link>
                        ) : (
                          <div className="flex items-center gap-3 p-3.5">{row}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}

          {hidden > 0 && (
            <button
              onClick={() => setShown(n => n + PAGE)}
              className="w-full py-2.5 rounded-xl text-xs font-semibold transition-colors hover:opacity-80"
              style={{ background: '#EAF0FA', color: ACCENT }}
            >
              Show {Math.min(PAGE, hidden)} more
              <span style={{ color: '#7A93C0', fontWeight: 500 }}> · {hidden} older</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
