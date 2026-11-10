'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, TrendingDown, ExternalLink } from 'lucide-react'
import type { MatchDetail } from '@/lib/match-detail'
import { dropLine } from '@/lib/price-drop-format'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`

function scoreStyle(score: number) {
  if (score >= 80) return { bg: '#E3F4EA', color: '#1F7A4D' }
  if (score >= 65) return { bg: '#EAF0FA', color: '#2E5288' }
  return { bg: '#FBEFD6', color: '#9A6516' }
}

/** "$300,000 – $450,000", "up to $450,000", or a dash when the client gave none. */
function range(min: number, max: number, suffix = ''): string {
  if (min > 0 && max > 0) return `${money(min)} – ${money(max)}${suffix}`
  if (max > 0) return `up to ${money(max)}${suffix}`
  if (min > 0) return `from ${money(min)}${suffix}`
  return '—'
}

interface Row { label: string; wants: string; has: string }

function rowsFor(m: MatchDetail): Row[] {
  const { property: p, client: c } = m
  const rent = p.transaction === 'For Rent'
  const r = c.req
  const areas = (r.locations?.length ? r.locations : [r.location]).filter(Boolean).join(', ')
  const extras = [r.garden && 'Garden', r.balcony && 'Balcony', r.terrace && 'Terrace'].filter(Boolean).join(', ')
  const has = [p.garden && 'Garden', p.balcony && 'Balcony', p.terrace && 'Terrace'].filter(Boolean).join(', ')
  const rows: Row[] = [
    { label: 'Deal', wants: r.transaction || '—', has: p.transaction },
    { label: 'Type', wants: r.type || '—', has: p.type },
    { label: 'Area', wants: areas || '—', has: [p.district, p.city].filter(Boolean).join(', ') || '—' },
    { label: rent ? 'Rent' : 'Price', wants: range(r.priceMin, r.priceMax, rent ? '/mo' : ''), has: money(rent ? p.rent : p.price) + (rent ? '/mo' : '') },
    { label: 'Bedrooms', wants: r.beds ? `${r.beds}+` : '—', has: String(p.beds) },
    { label: 'Bathrooms', wants: r.baths ? `${r.baths}+` : '—', has: String(p.baths) },
    { label: 'Size', wants: r.size ? `${r.size}+ m²` : '—', has: p.size ? `${p.size} m²` : '—' },
  ]
  if (r.view) rows.push({ label: 'View', wants: r.view, has: p.view || '—' })
  if (extras) rows.push({ label: 'Extras', wants: extras, has: has || 'None listed' })
  return rows
}

/**
 * The listing and the client's request, side by side — what an agent wants to
 * see after tapping a match alert, before deciding to message the client.
 */
export default function MatchDetailModal({ propertyId, clientId, onClose }: {
  propertyId: number
  clientId: number
  onClose: () => void
}) {
  const [match, setMatch] = useState<MatchDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let live = true
    setState('loading')
    fetch(`/api/alerts/match?property=${propertyId}&client=${clientId}`)
      .then(async res => {
        if (!live) return
        if (!res.ok) { setState('missing'); return }
        const data = await res.json()
        setMatch(data.match as MatchDetail)
        setState('ready')
      })
      .catch(() => { if (live) setState('missing') })
    return () => { live = false }
  }, [propertyId, clientId])

  // Escape closes it, like every other window in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sc = match ? scoreStyle(match.score) : null
  const photo = match?.property.photos?.[0]

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      style={{ background: 'rgba(14,31,61,0.55)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full md:max-w-2xl max-h-[92vh] overflow-y-auto bg-white"
        style={{ borderRadius: '20px 20px 0 0', fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>

        <div className="sticky top-0 bg-white flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1.5px solid ${LINE}` }}>
          <p className="text-sm font-bold" style={{ color: H }}>Match details</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5" style={{ color: SUB }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {state === 'loading' && <p className="p-6 text-sm" style={{ color: SUB }}>Loading…</p>}
        {state === 'missing' && (
          <p className="p-6 text-sm" style={{ color: SUB }}>
            This match is no longer available. The listing or the client may have been removed.
          </p>
        )}

        {state === 'ready' && match && sc && (
          <div className="p-4 space-y-4">
            <div className="flex gap-3">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" className="h-20 w-24 shrink-0 rounded-xl object-cover" />
              )}
              <div className="min-w-0">
                <p className="text-base font-bold" style={{ color: H }}>{match.property.title}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                    {match.score}% match
                  </span>
                  {match.reason === 'price_drop' && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                      style={{ background: '#FBE7E7', color: '#A23434' }}>
                      <TrendingDown className="h-3 w-3" /> PRICE DROP
                    </span>
                  )}
                </div>
                {match.reason === 'price_drop' && !!match.oldPrice && (
                  <p className="mt-1 text-xs font-semibold" style={{ color: '#A23434' }}>
                    {dropLine(match.oldPrice, match.property.transaction === 'For Rent' ? match.property.rent : match.property.price, match.property.transaction === 'For Rent')}
                  </p>
                )}
              </div>
            </div>

            {/* The comparison: what the client asked for, against what the listing is. */}
            <div className="rounded-xl overflow-hidden" style={{ border: `1.5px solid ${LINE}` }}>
              <div className="grid grid-cols-[88px_1fr_1fr] text-[11px] font-bold uppercase tracking-wide px-3 py-2"
                style={{ background: '#F7F8FB', color: SUB }}>
                <span />
                <span>{match.client.name} wants</span>
                <span>Listing has</span>
              </div>
              {rowsFor(match).map(row => (
                <div key={row.label} className="grid grid-cols-[88px_1fr_1fr] gap-2 px-3 py-2 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
                  <span className="text-xs font-semibold" style={{ color: SUB }}>{row.label}</span>
                  <span style={{ color: H }}>{row.wants}</span>
                  <span style={{ color: H, fontWeight: 600 }}>{row.has}</span>
                </div>
              ))}
            </div>

            {match.client.req.notes && (
              <div className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: SUB }}>Client&apos;s notes</p>
                <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: H }}>{match.client.req.notes}</p>
              </div>
            )}

            <div className="flex gap-2 flex-wrap pb-2">
              <Link href={`/properties?open=${match.property.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold text-white"
                style={{ background: '#14223F' }}>
                <ExternalLink className="h-4 w-4" /> Open listing
              </Link>
              {match.canOpenClient && (
                <Link href={`/clients?open=${match.client.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold"
                  style={{ border: `1.5px solid ${LINE}`, color: H }}>
                  <ExternalLink className="h-4 w-4" /> Open client
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
