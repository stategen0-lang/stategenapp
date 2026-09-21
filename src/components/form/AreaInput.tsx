'use client'

// An area field that suggests real Lebanese places as you type.
//
// Free text is never rejected: an agent with a listing in a hamlet nobody has
// heard of types it and it saves. What this does is stop the SAME place being
// stored five ways — picking a suggestion, or typing a spelling the gazetteer
// recognises for certain, stores the canonical name, so Achrafieh, Ashrafiyeh
// and El Achrafiye all become one area that matching can actually compare.
//
// The 53 KB of place data is fetched on first focus, not on page load.

import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { loadAreas, loadedAreas, areaLabel, searchAreas, resolveArea, type Area, type AreaIndex } from '@/lib/lebanon/areas'
import { toPlace } from '@/lib/whatsapp/writes'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when the text settles on a known area (picked or recognised). */
  onArea?: (area: Area | null) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  /**
   * Committed with Enter, with a tap on a suggestion, or by leaving the field
   * — the client form turns each one into a chip. It is handed the settled
   * text, because onChange has not reached state yet when this fires.
   */
  onEnter?: (value: string) => void
  autoFocus?: boolean
}

export default function AreaInput({
  value, onChange, onArea, placeholder = 'e.g. Achrafieh',
  className, style, onEnter, autoFocus,
}: Props) {
  const [index, setIndex] = useState<AreaIndex | null>(loadedAreas())
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<Area[]>([])
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetched once, on the first focus of the first area field in the session.
  function ensureLoaded() {
    if (index) return
    loadAreas().then(setIndex).catch(() => {})
  }

  useEffect(() => {
    if (!index || !open) return
    setHits(searchAreas(index, value, 8))
    setActive(0)
  }, [index, open, value])

  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  function pick(area: Area) {
    onChange(area.name)
    onArea?.(area)
    setOpen(false)
  }

  /**
   * Leaving the field: correct the spelling when the gazetteer is sure, and
   * otherwise leave the agent's own words alone, tidied the way they always
   * were. A place we do not know must still be saveable.
   */
  function settle(): string {
    const typed = value.trim()
    if (!typed) { onArea?.(null); return '' }
    const found = index ? resolveArea(index, typed) : null
    if (found?.confident) {
      if (found.area.name !== typed) onChange(found.area.name)
      onArea?.(found.area)
      return found.area.name
    }
    const tidy = toPlace(typed) || typed
    if (tidy !== typed) onChange(tidy)
    onArea?.(null)
    return tidy
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !hits.length) {
      if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(settle()) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % hits.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + hits.length) % hits.length) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      pick(hits[active])
      onEnter?.(hits[active].name)
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative" ref={wrap}>
      <input
        className={className}
        style={style}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { ensureLoaded(); setOpen(true) }}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        // A tap on a suggestion blurs the input first, so the list has to
        // outlive the blur by a moment or the tap lands on nothing.
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            const settled = settle()
            if (settled) onEnter?.(settled)
          }, 150)
        }}
      />

      {open && hits.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-y-auto z-30"
          style={{ background: '#fff', border: '1.5px solid #EEF0F4', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 240 }}
        >
          {hits.map((a, i) => (
            <button
              key={a.slug}
              type="button"
              // onMouseDown, not onClick: the blur would otherwise close the
              // list before the click could register.
              onMouseDown={e => { e.preventDefault(); pick(a); onEnter?.(a.name) }}
              onMouseEnter={() => setActive(i)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
              style={{ background: i === active ? '#F4F7FC' : '#fff', borderTop: i ? '1px solid #F4F5F8' : 'none' }}
            >
              <MapPin size={13} style={{ color: '#9AA3B2', flexShrink: 0 }} />
              <span className="text-sm font-medium truncate" style={{ color: '#14223F' }}>{a.name}</span>
              <span className="text-xs ml-auto pl-2 truncate" style={{ color: '#9AA3B2' }}>
                {areaLabel(a).split(' · ')[1] ?? ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
