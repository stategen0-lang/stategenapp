'use client'

import { useState, useRef } from 'react'

// A scrollable listing gallery for the public shared-listing page: a main image
// with prev/next arrows, a photo counter, swipe on touch, and a clickable
// thumbnail strip. `children` (badges + title/price overlay) render over the
// active photo. Client component so it can hold the active-index state; it's
// dropped into the server-rendered page as an island.
export default function PhotoGallery({
  photos, title, accent = '#5E8FD6', children,
}: {
  photos: string[]
  title: string
  accent?: string
  children?: React.ReactNode
}) {
  const [i, setI] = useState(0)
  const startX = useRef<number | null>(null)

  const has = photos.length > 0
  const many = photos.length > 1
  const idx = has ? ((i % photos.length) + photos.length) % photos.length : 0
  const go = (d: number) => setI(p => (p + d + photos.length) % photos.length)

  return (
    <div>
      <div
        className="relative w-full select-none"
        style={{ aspectRatio: '16 / 10', background: '#E3E7EE' }}
        onTouchStart={e => { startX.current = e.touches[0]?.clientX ?? null }}
        onTouchEnd={e => {
          if (startX.current == null || !many) return
          const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
          startX.current = null
        }}
      >
        {has
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photos[idx]} alt={title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: '#9AA3B2' }}>No photo</div>}

        {/* darkening scrim so overlaid text stays legible; never blocks taps */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(9,16,32,0.85) 0%, rgba(9,16,32,0.35) 34%, rgba(9,16,32,0) 62%)' }} />

        {/* caller's overlay (badges, title, price) */}
        <div className="absolute inset-0 z-10 pointer-events-none">{children}</div>

        {many && (
          <>
            <button
              type="button" aria-label="Previous photo" onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full flex items-center justify-center text-white text-2xl leading-none"
              style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
            >‹</button>
            <button
              type="button" aria-label="Next photo" onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full flex items-center justify-center text-white text-2xl leading-none"
              style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
            >›</button>
            <span
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 text-xs font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
            >{idx + 1} / {photos.length}</span>
          </>
        )}
      </div>

      {many && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto">
          {photos.map((src, k) => (
            <button
              key={k} type="button" onClick={() => setI(k)}
              className="shrink-0 rounded-xl overflow-hidden transition-opacity"
              style={{ width: 92, height: 66, border: k === idx ? `2px solid ${accent}` : '2px solid transparent', opacity: k === idx ? 1 : 0.6 }}
              aria-label={`Photo ${k + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
