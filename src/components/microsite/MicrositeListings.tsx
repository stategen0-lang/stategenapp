'use client'

import { useMemo, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { formatPrice, TYPE_GRADIENTS } from '@/lib/data'
import CardPhotos from '@/components/listing/CardPhotos'
import FactBadges from '@/components/listing/FactBadges'
import {
  applyFilters, filterOptions, filtersFromQuery, filtersToQuery, isFiltered, NO_FILTERS,
  type Filters, type Deal, type Sort,
} from '@/lib/microsite-filter'

// The listings grid on the public agency page, with the filters a client uses
// to narrow it down. The filtered view lives in the URL (?deal=rent&area=…), so
// a client — or the agent — can send someone exactly that view.

export interface MicrositeCard {
  token: string; title: string; type: string; transaction: string; price: number; rent: number
  district: string; city: string; beds: number; baths: number; size: number; parkings: number
  view: string; terrace: boolean; balcony: boolean; garden: boolean; photos: string[]; hasVideo: boolean
}

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#E3E7EE'

// 16px text: iOS zooms the page into any smaller input when it's focused.
const control = 'h-10 rounded-xl bg-white px-3 text-[16px] sm:text-sm outline-none focus-visible:ring-2 min-w-0'

export default function MicrositeListings({ cards, accent, initialQuery }: { cards: MicrositeCard[]; accent: string; initialQuery: string }) {
  const [f, setF] = useState<Filters>(() => filtersFromQuery(new URLSearchParams(initialQuery)))
  const options = useMemo(() => filterOptions(cards), [cards])
  const shown = useMemo(() => applyFilters(cards, f), [cards, f])
  const priceAccent = accent === '#14223F' ? '#1F7A4D' : accent

  function update(next: Partial<Filters>) {
    const merged = { ...f, ...next }
    setF(merged)
    try {
      const q = filtersToQuery(merged, new URLSearchParams(window.location.search)).toString()
      window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname)
    } catch { /* the URL is a convenience; filtering works without it */ }
  }

  const priceUnit = f.deal === 'rent' ? ' /mo' : ''
  const toNum = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v.replace(/[^\d]/g, '')) || 0))
  const ringStyle = { border: `1px solid ${LINE}`, color: H, ['--tw-ring-color' as string]: accent } as React.CSSProperties

  return (
    <section aria-label="Listings">
      {cards.length > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-3 sm:p-4" style={{ border: '1px solid #EEF0F4', boxShadow: '0 2px 10px rgba(20,34,63,0.06)' }}>
          <div className="flex items-center gap-2 mb-3">
            <SlidersHorizontal size={16} style={{ color: SUB }} aria-hidden />
            <p className="text-sm font-bold" style={{ color: H }}>Find a property</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {options.hasSale && options.hasRent && (
              <div role="group" aria-label="Buy or rent" className="col-span-2 sm:col-span-3 lg:col-span-2 flex h-10 rounded-xl p-1 gap-1" style={{ background: '#F1F3F7' }}>
                {([['all', 'All'], ['sale', 'Buy'], ['rent', 'Rent']] as [Deal, string][]).map(([value, label]) => {
                  const on = f.deal === value
                  return (
                    <button key={value} type="button" aria-pressed={on} onClick={() => update({ deal: value, minPrice: null, maxPrice: null })}
                      className="flex-1 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2"
                      style={on ? { background: accent, color: readableOn(accent) } : { color: SUB }}>
                      {label}
                    </button>
                  )
                })}
              </div>
            )}

            {options.types.length > 1 && (
              <select id="f-type" aria-label="Property type" className={control} style={ringStyle} value={f.type} onChange={e => update({ type: e.target.value })}>
                <option value="">Any type</option>
                {options.types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            {options.areas.length > 1 && (
              <select id="f-area" aria-label="Area" className={control} style={ringStyle} value={f.area} onChange={e => update({ area: e.target.value })}>
                <option value="">Any area</option>
                {options.areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            )}

            <select id="f-beds" aria-label="Bedrooms" className={control} style={ringStyle} value={f.beds} onChange={e => update({ beds: Number(e.target.value) })}>
              <option value={0}>Any beds</option>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}+ beds</option>)}
            </select>

            <select id="f-sort" aria-label="Sort by" className={control} style={ringStyle} value={f.sort} onChange={e => update({ sort: e.target.value as Sort })}>
              <option value="newest">Newest first</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>

            <input id="f-min" inputMode="numeric" aria-label={`Minimum price${priceUnit}`} placeholder={`Min $${priceUnit}`} className={control} style={ringStyle}
              value={f.minPrice ?? ''} onChange={e => update({ minPrice: toNum(e.target.value) })} />
            <input id="f-max" inputMode="numeric" aria-label={`Maximum price${priceUnit}`} placeholder={`Max $${priceUnit}`} className={control} style={ringStyle}
              value={f.maxPrice ?? ''} onChange={e => update({ maxPrice: toNum(e.target.value) })} />
          </div>

          <div className="flex items-center justify-between gap-3 mt-3">
            <p className="text-xs font-semibold" style={{ color: SUB }} aria-live="polite">
              {shown.length} of {cards.length} propert{cards.length === 1 ? 'y' : 'ies'}
            </p>
            {isFiltered(f) && (
              <button type="button" onClick={() => update({ ...NO_FILTERS, sort: f.sort })} className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1 focus-visible:outline-2" style={{ color: accent === '#14223F' ? H : accent }}>
                <X size={13} aria-hidden /> Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <p className="text-sm text-center py-16" style={{ color: SUB }}>No available listings right now — check back soon.</p>
      ) : shown.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-sm font-semibold" style={{ color: H }}>Nothing matches those filters.</p>
          <p className="text-sm mt-1" style={{ color: SUB }}>Try fewer filters — or tell us what you&apos;re looking for below, and an agent will reach out.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {shown.map(card => {
            const price = card.transaction === 'For Rent' ? `${formatPrice(card.rent)}/mo` : formatPrice(card.price)
            return (
              <a key={card.token} href={`/l/${card.token}`} className="block rounded-2xl bg-white overflow-hidden transition-transform hover:-translate-y-0.5"
                style={{ border: '1px solid #EEF0F4', boxShadow: '0 2px 10px rgba(20,34,63,0.06)' }}>
                {/* Swipe through the listing's photos; badges sit on the first one. */}
                <CardPhotos photos={card.photos} title={card.title} fallback={TYPE_GRADIENTS[card.type as keyof typeof TYPE_GRADIENTS] ?? '#E3E7EE'}>
                  <span className="absolute top-2.5 left-2.5 text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }}>
                    {card.type} · {card.transaction}
                  </span>
                  {card.hasVideo && (
                    <span className="absolute top-2.5 right-2.5 text-xs font-semibold px-2 py-1 rounded-full text-white" style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }} title="Has a video walkthrough">
                      🎥
                    </span>
                  )}
                </CardPhotos>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: H }}>{card.title}</p>
                    <p className="text-sm font-extrabold whitespace-nowrap" style={{ color: priceAccent }}>{price}</p>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: SUB }}>{[card.district, card.city].filter(Boolean).join(', ')}</p>
                  <FactBadges listing={card} className="mt-2" />
                </div>
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#14223F' : '#ffffff'
}
