'use client'

import { useRef, useState } from 'react'

// Photo strip for a listing card on the agency catalog (/a/<slug>). Swipe
// between a listing's photos on a phone (arrows on hover on desktop) without
// leaving the catalog; tapping still follows the card's link to the listing.
// The card's badges belong to the first photo only and scroll away with it.

const MAX = 8   // enough to get a feel for the place; the listing page has the rest
const GLASS = { background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' } as const

export default function CardPhotos({ photos, title, fallback, children }: {
  photos: string[]
  title: string
  /** Background when there are no photos (the property type's gradient). */
  fallback: string
  /** Badges drawn over the first photo. */
  children?: React.ReactNode
}) {
  const shown = photos.slice(0, MAX)
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const onScroll = () => {
    const el = ref.current
    if (el?.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  // Arrows sit inside the card's <a>: stop the click from opening the listing.
  const step = (e: React.MouseEvent, d: number) => {
    e.preventDefault(); e.stopPropagation()
    const el = ref.current
    if (el) el.scrollTo({ left: (index + d) * el.clientWidth, behavior: 'smooth' })
  }

  if (!shown.length) {
    return (
      <div className="relative w-full" style={{ aspectRatio: '16 / 10', background: fallback }}>
        {children}
      </div>
    )
  }

  return (
    <div className="group relative w-full" style={{ aspectRatio: '16 / 10', background: fallback }}>
      <div ref={ref} onScroll={onScroll}
        className="no-scrollbar absolute inset-0 flex overflow-x-auto snap-x snap-mandatory"
        style={{ overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {shown.map((src, k) => (
          <div key={k} className="relative shrink-0 w-full h-full snap-center snap-always">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={k === 0 ? title : `${title} — photo ${k + 1}`} className="w-full h-full object-cover"
              draggable={false} loading={k === 0 ? 'eager' : 'lazy'} />
            {k === 0 && children}
          </div>
        ))}
      </div>

      {shown.length > 1 && (
        <>
          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5 pointer-events-none">
            {shown.map((_, k) => (
              <span key={k} className="rounded-full transition-all"
                style={{ width: k === index ? 16 : 6, height: 6, background: k === index ? '#fff' : 'rgba(255,255,255,0.6)', boxShadow: '0 0 4px rgba(0,0,0,0.35)' }} />
            ))}
          </div>
          {index > 0 && (
            <button type="button" aria-label="Previous photo" onClick={e => step(e, -1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hidden md:group-hover:flex items-center justify-center text-white text-xl leading-none" style={GLASS}>‹</button>
          )}
          {index < shown.length - 1 && (
            <button type="button" aria-label="Next photo" onClick={e => step(e, 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hidden md:group-hover:flex items-center justify-center text-white text-xl leading-none" style={GLASS}>›</button>
          )}
        </>
      )}
    </div>
  )
}
