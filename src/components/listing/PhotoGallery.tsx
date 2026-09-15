'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// The public shared-listing page's gallery.
//
//   • The main photo is a native horizontal scroller (scroll-snap), so on a phone
//     it swipes with the finger like any photo app; arrows do the same on desktop.
//   • `children` (badges, title, price) belong to the FIRST photo only — they
//     scroll away with it, so the other photos are shown clean.
//   • The thumbnail strip underneath still jumps to any photo.
//   • Tapping the main photo opens it full screen, where you can keep swiping.
//
// A client component so it can hold the active index; dropped into the
// server-rendered page as an island.

function useSnapIndex(ref: React.RefObject<HTMLDivElement | null>, count: number) {
  const [index, setIndex] = useState(0)
  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    setIndex(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth))))
  }, [ref, count])
  const scrollTo = useCallback((k: number, smooth = true) => {
    const el = ref.current
    if (!el) return
    const target = Math.max(0, Math.min(count - 1, k))
    el.scrollTo({ left: target * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
  }, [ref, count])
  return { index, onScroll, scrollTo }
}

const ARROW = 'absolute top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full items-center justify-center text-white text-2xl leading-none'
const GLASS = { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' } as const

export default function PhotoGallery({
  photos, title, accent = '#5E8FD6', children,
}: {
  photos: string[]
  title: string
  accent?: string
  children?: React.ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const { index, onScroll, scrollTo } = useSnapIndex(scroller, photos.length)
  const [fullscreen, setFullscreen] = useState<number | null>(null)
  const many = photos.length > 1

  if (!photos.length) {
    return (
      <div className="relative w-full select-none" style={{ aspectRatio: '16 / 10', background: '#E3E7EE' }}>
        <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: '#9AA3B2' }}>No photo</div>
        <Scrim />
        <div className="absolute inset-0 z-10 pointer-events-none">{children}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="relative w-full select-none" style={{ aspectRatio: '16 / 10', background: '#E3E7EE' }}>
        <div
          ref={scroller}
          onScroll={onScroll}
          className="no-scrollbar absolute inset-0 flex overflow-x-auto snap-x snap-mandatory"
          style={{ overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          {photos.map((src, k) => (
            // A div, not a <button>: the first slide carries the page's <h1>
            // (title overlay), and headings aren't valid inside a button.
            <div
              key={k} role="button" tabIndex={0}
              onClick={() => setFullscreen(k)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFullscreen(k) } }}
              className="relative shrink-0 w-full h-full snap-center snap-always cursor-zoom-in"
              aria-label={`Open photo ${k + 1} full screen`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={k === 0 ? title : `${title} — photo ${k + 1}`} className="w-full h-full object-cover" draggable={false}
                loading={k === 0 ? 'eager' : 'lazy'} />
              {/* The listing's details live on the first photo only and scroll with it. */}
              {k === 0 && (
                <>
                  <Scrim />
                  <div className="absolute inset-0 z-10 pointer-events-none text-left">{children}</div>
                </>
              )}
            </div>
          ))}
        </div>

        {many && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => scrollTo(index - 1)} disabled={index === 0}
              className={`${ARROW} left-2 hidden md:flex disabled:opacity-0`} style={GLASS}>‹</button>
            <button type="button" aria-label="Next photo" onClick={() => scrollTo(index + 1)} disabled={index === photos.length - 1}
              className={`${ARROW} right-2 hidden md:flex disabled:opacity-0`} style={GLASS}>›</button>
            <span className="absolute top-3 right-3 z-20 text-xs font-semibold px-2 py-0.5 rounded-full text-white pointer-events-none" style={GLASS}>
              {index + 1} / {photos.length}
            </span>
          </>
        )}
      </div>

      {many && (
        <div className="no-scrollbar flex gap-2 px-4 py-3 overflow-x-auto">
          {photos.map((src, k) => (
            <button
              key={k} type="button" onClick={() => scrollTo(k)}
              className="shrink-0 rounded-xl overflow-hidden transition-opacity"
              style={{ width: 92, height: 66, border: k === index ? `2px solid ${accent}` : '2px solid transparent', opacity: k === index ? 1 : 0.6 }}
              aria-label={`Photo ${k + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {fullscreen !== null && (
        <Lightbox photos={photos} title={title} start={fullscreen}
          onClose={last => { setFullscreen(null); scrollTo(last, false) }} />
      )}
    </div>
  )
}

function Scrim() {
  // Darkens the bottom so overlaid text stays legible; never blocks taps.
  return <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(9,16,32,0.85) 0%, rgba(9,16,32,0.35) 34%, rgba(9,16,32,0) 62%)' }} />
}

/** Full-screen viewer: swipe (or arrow keys) between photos, ✕ / Esc to close. */
export function Lightbox({ photos, title, start, onClose }: {
  photos: string[]; title: string; start: number; onClose: (lastIndex: number) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const { index, onScroll, scrollTo } = useSnapIndex(scroller, photos.length)
  const indexRef = useRef(start)
  indexRef.current = index
  const close = useCallback(() => onClose(indexRef.current), [onClose])

  // Open on the photo that was tapped, before the first paint of the strip.
  useEffect(() => { scrollTo(start, false) }, [scrollTo, start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') scrollTo(indexRef.current + 1)
      if (e.key === 'ArrowLeft') scrollTo(indexRef.current - 1)
    }
    window.addEventListener('keydown', onKey)
    // Keep the page behind from scrolling while the viewer is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [close, scrollTo])

  const many = photos.length > 1
  return (
    <div className="fixed inset-0 z-[100] select-none" style={{ background: '#000' }} role="dialog" aria-modal="true" aria-label={`${title} photos`}>
      <div ref={scroller} onScroll={onScroll}
        className="no-scrollbar absolute inset-0 flex overflow-x-auto snap-x snap-mandatory"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {photos.map((src, k) => (
          <div key={k} className="shrink-0 w-full h-full snap-center snap-always flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${title} — photo ${k + 1}`} className="max-w-full max-h-full object-contain" draggable={false} />
          </div>
        ))}
      </div>

      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 z-10"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <span className="text-sm font-semibold px-2.5 py-1 rounded-full text-white" style={GLASS}>
          {many ? `${index + 1} / ${photos.length}` : title}
        </span>
        <button type="button" onClick={close} aria-label="Close"
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xl leading-none" style={GLASS}>✕</button>
      </div>

      {many && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => scrollTo(index - 1)} disabled={index === 0}
            className={`${ARROW} left-3 hidden md:flex disabled:opacity-0`} style={GLASS}>‹</button>
          <button type="button" aria-label="Next photo" onClick={() => scrollTo(index + 1)} disabled={index === photos.length - 1}
            className={`${ARROW} right-3 hidden md:flex disabled:opacity-0`} style={GLASS}>›</button>
        </>
      )}
    </div>
  )
}
