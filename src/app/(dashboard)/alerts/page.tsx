'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Check } from 'lucide-react'
import type { AlertView } from '@/lib/alerts'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

function scoreStyle(score: number) {
  if (score >= 80) return { bg: '#E3F4EA', color: '#1F7A4D' }
  if (score >= 65) return { bg: '#EAF0FA', color: '#2E5288' }
  return { bg: '#FBEFD6', color: '#9A6516' }
}

export default function AlertsPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)
  const [alerts, setAlerts] = useState<AlertView[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.alerts)) setAlerts(data.alerts)
      }
    } catch { /* keep what's on screen */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const unseen = alerts.filter(a => !a.seen).length

  async function markAll() {
    setAlerts(prev => prev.map(a => ({ ...a, seen: true })))   // optimistic
    try { await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }) }
    catch { load() }
  }

  async function markOne(id: string) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, seen: true } : a))
    try { await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }) }
    catch { load() }
  }

  return (
    <div className="p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Alerts</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: SUB }}>
            {loading ? 'Loading…'
              : alerts.length === 0 ? 'New listings that match your clients will appear here'
              : manager ? `${alerts.length} match${alerts.length === 1 ? '' : 'es'} across the agency${unseen ? ` · ${unseen} new` : ''}`
              : `${alerts.length} listing${alerts.length === 1 ? '' : 's'} matched to your clients${unseen ? ` · ${unseen} new` : ''}`}
          </p>
        </div>
        {unseen > 0 && (
          <button onClick={markAll}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ border: `1.5px solid ${LINE}`, background: '#F7F8FB', color: H }}>
            <Check className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {!loading && alerts.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={{ border: `1.5px dashed ${LINE}` }}>
          <Bell className="h-6 w-6 mx-auto mb-2" style={{ color: '#C4CAD6' }} />
          <p className="text-sm font-semibold" style={{ color: H }}>No alerts yet</p>
          <p className="text-xs mt-1" style={{ color: SUB }}>
            When a new listing is added that fits a client&apos;s brief, you&apos;ll be notified here.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {alerts.map(a => {
          const sc = scoreStyle(a.score)
          return (
            <div
              key={a.id}
              onClick={() => !a.seen && markOne(a.id)}
              className="rounded-xl p-3 flex items-start gap-3 transition-colors"
              style={{
                border: `1.5px solid ${a.seen ? LINE : '#CFE0F5'}`,
                background: a.seen ? '#fff' : '#F5F9FE',
                cursor: a.seen ? 'default' : 'pointer',
              }}
            >
              {/* Unseen dot */}
              <div className="pt-1 shrink-0" style={{ width: 8 }}>
                {!a.seen && <div className="w-2 h-2 rounded-full" style={{ background: '#2E5288' }} />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold" style={{ color: H }}>{a.propertyTitle}</p>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                    {a.score}% match
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: SUB }}>
                  matches <span style={{ color: H, fontWeight: 600 }}>{a.clientName}</span>
                  {a.propertyLabel ? ` · ${a.propertyLabel}` : ''}
                </p>
                {manager && a.agentName && (
                  <p className="text-[11px] mt-1 font-semibold" style={{ color: '#2E5288' }}>{a.agentName}&apos;s client</p>
                )}
              </div>

              <span className="text-xs shrink-0" style={{ color: '#9AA3B2' }}>{timeAgo(a.created_at)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
