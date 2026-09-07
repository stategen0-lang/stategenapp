'use client'

import { Activity as ActivityIcon } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import { isManager } from '@/lib/permissions'
import { ACTIVITY_ICON, activityAgo, type ActivityItem, type ActivityKind } from '@/lib/activity'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

const KIND_BG: Record<ActivityKind, string> = {
  listing_added: '#EAF0FA',
  client_added: '#EDEAFA',
  deal_moved: '#FBF0DA',
  deal_won: '#E3F4EA',
  deal_lost: '#FBE7E7',
  offer_logged: '#FBF0DA',
  event_scheduled: '#EAF0FA',
  client_referred: '#EDEAFA',
}

// Bucket items under Today / Yesterday / a date, for a readable feed.
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
  // Cached: a revisit shows the last feed instantly while it revalidates.
  const { data } = useCachedFetch<{ items?: ActivityItem[] }>('activity', '/api/activity')
  const items: ActivityItem[] | null = data ? (Array.isArray(data.items) ? data.items : []) : null

  // Group the (already newest-first) items by day, preserving order.
  const groups: { label: string; items: ActivityItem[] }[] = []
  for (const it of items ?? []) {
    const label = dayLabel(it.at)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(it)
    else groups.push({ label, items: [it] })
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <ActivityIcon className="h-6 w-6" style={{ color: '#2E5288' }} />
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Activity</h1>
        </div>
        <p className="text-sm mt-0.5" style={{ color: SUB }}>
          {manager ? 'Everything your team has done recently — new listings, clients, and deal moves.'
                   : 'Your recent listings, clients, and deal moves.'}
        </p>
      </div>

      {items === null ? (
        <p className="text-sm py-10 text-center" style={{ color: SUB }}>Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ border: `1.5px dashed ${LINE}` }}>
          <ActivityIcon className="h-6 w-6 mx-auto mb-2" style={{ color: '#C4CAD6' }} />
          <p className="text-sm font-semibold" style={{ color: H }}>Nothing yet</p>
          <p className="text-xs mt-1" style={{ color: SUB }}>New listings, clients, and deal moves will show up here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label}>
              <p className="text-xs font-bold uppercase mb-2.5" style={{ color: '#9AA3B2', letterSpacing: '0.06em' }}>{group.label}</p>
              <div className="rounded-2xl bg-white overflow-hidden" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="divide-y" style={{ borderColor: LINE }}>
                  {group.items.map(it => (
                    <div key={it.id} className="flex items-center gap-3 p-3.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: KIND_BG[it.kind] }}>
                        {ACTIVITY_ICON[it.kind]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: H }}>{it.summary}</p>
                        <p className="text-xs truncate" style={{ color: SUB }}>
                          {[it.detail, manager ? it.agentName : null].filter(Boolean).join(' · ') || ' '}
                        </p>
                      </div>
                      <span className="text-xs shrink-0" style={{ color: '#9AA3B2' }}>{activityAgo(it.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
