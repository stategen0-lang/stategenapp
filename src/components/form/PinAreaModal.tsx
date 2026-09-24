'use client'

// "Where is this?" — the one question that teaches the app a new place.
//
// An agent typed somewhere the gazetteer has never heard of. Rather than save
// the text and forget it, they drop a pin. From then on that area is theirs:
// suggested as they type, spelled one way across the agency, and used by
// matching like any built-in place. The caza is worked out on the server from
// the nearest known town, so this asks for a pin and nothing else.
//
// Leaflet is loaded here on demand, the same as the properties map.

import { useEffect, useRef, useState } from 'react'
import { MapPin, X, Link2, Loader2 } from 'lucide-react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import { readMapsPaste } from '@/lib/maps-link'

const H = '#14223F'
const SUB = '#6A7488'

interface Props {
  /** What the agent typed; they can still correct the spelling here. */
  name: string
  onClose: () => void
  /** Saved: the canonical name, so the field can be set to it. */
  onSaved: (name: string) => void
}

export default function PinAreaModal({ name: initialName, onClose, onSaved }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const marker = useRef<Marker | null>(null)
  const [name, setName] = useState(initialName)
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')

  /** Put the marker somewhere and move the map to it. */
  const placeRef = useRef<((lat: number, lng: number, zoom?: number) => void) | null>(null)

  /**
   * Read a pasted Google Maps link. Most of them carry the coordinates in the
   * text, so nothing is sent anywhere; the phone's Share link does not, and
   * that one has to be followed by the server — see /api/maps/resolve.
   */
  async function useLink(raw: string) {
    const text = raw.trim()
    if (!text || linkBusy) return
    setLinkError('')

    const verdict = readMapsPaste(text)
    if (verdict.kind === 'point') {
      placeRef.current?.(verdict.point.lat, verdict.point.lng, 15)
      return
    }
    if (verdict.kind === 'error') { setLinkError(verdict.error); return }

    setLinkBusy(true)
    try {
      const res = await fetch('/api/maps/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: verdict.url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.point) {
        setLinkError(data?.error ?? 'That link could not be read. Tap the map instead.')
      } else {
        placeRef.current?.(data.point.lat, data.point.lng, 15)
      }
    } catch {
      setLinkError('Could not reach the server. Tap the map instead.')
    }
    setLinkBusy(false)
  }

  useEffect(() => {
    let live = true
    let created: LeafletMap | null = null

    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        await import('leaflet/dist/leaflet.css')
        if (!live || !holder.current || map.current) return

        created = L.map(holder.current).setView([33.85, 35.65], 10)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(created)
        created.invalidateSize()

        // One way in for both the map tap and a pasted link, so a link that
        // lands slightly off can still be nudged by tapping.
        const place = (lat: number, lng: number, zoom?: number) => {
          setPin({ lat, lng })
          setError('')
          setLinkError('')
          if (marker.current) marker.current.setLatLng([lat, lng])
          else marker.current = L.marker([lat, lng], {
            icon: L.divIcon({
              className: '',
              html: `<div style="width:20px;height:20px;border-radius:50%;background:${H};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.4)"></div>`,
              iconSize: [20, 20], iconAnchor: [10, 10],
            }),
          }).addTo(created!)
          if (zoom) created!.setView([lat, lng], zoom)
        }
        placeRef.current = place

        created.on('click', (e: { latlng: { lat: number; lng: number } }) => place(e.latlng.lat, e.latlng.lng))

        map.current = created
      } catch {
        if (live) setError('The map could not load. Check your connection and try again.')
      }
    })()

    return () => { live = false; map.current?.remove(); map.current = null; created?.remove() }
  }, [])

  // Escape closes, as everywhere else in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    if (!pin || !name.trim() || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), lat: pin.lat, lng: pin.lng }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'That could not be saved. Please try again.')
        setBusy(false)
        return
      }
      onSaved(data?.area?.name ?? name.trim())
    } catch {
      setError('Could not reach the server. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3"
      style={{ background: 'rgba(10,20,40,0.45)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white overflow-hidden"
        style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>

        <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: H }}>Add this area</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>
              Paste a Google Maps link, or tap the map. Everyone in your agency can use it from then on.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: SUB }}><X className="h-5 w-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold" style={{ color: '#9AA3B2' }}>AREA NAME</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-base sm:text-sm outline-none mt-1"
              style={{ border: '1.5px solid #EEF0F4', color: H }}
              placeholder="e.g. Hbous"
            />
          </div>

          {/* The quickest way in: the agent already has the place open in
              Google Maps on their phone. Share → paste → done. */}
          <div>
            <label className="text-[11px] font-bold" style={{ color: '#9AA3B2' }}>PASTE A GOOGLE MAPS LINK</label>
            <div className="flex gap-2 mt-1">
              <input
                value={link}
                onChange={e => { setLink(e.target.value); setLinkError('') }}
                onPaste={e => {
                  // Acting on the paste itself saves a tap — the agent has just
                  // come from Google Maps and has nothing else to say.
                  const text = e.clipboardData?.getData('text') ?? ''
                  if (text.trim()) { setLink(text.trim()); setTimeout(() => useLink(text), 0) }
                }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); useLink(link) } }}
                className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-base sm:text-sm outline-none"
                style={{ border: '1.5px solid #EEF0F4', color: H }}
                placeholder="https://maps.app.goo.gl/…"
                spellCheck={false}
              />
              <button
                onClick={() => useLink(link)}
                disabled={!link.trim() || linkBusy}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
                style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: H }}
              >
                {linkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Use
              </button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: SUB }}>
              In Google Maps: hold the spot, tap Share, then paste it here. Coordinates work too.
            </p>
            {linkError && (
              <p className="text-xs mt-1.5 px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{linkError}</p>
            )}
          </div>

          <p className="text-[11px] text-center" style={{ color: '#9AA3B2' }}>— or tap the map —</p>

          <div ref={holder} className="rounded-xl overflow-hidden"
            style={{ height: 'clamp(240px, 42vh, 380px)', border: '1.5px solid #EEF0F4', background: '#EEF2F7' }} />

          <p className="text-xs" style={{ color: pin ? '#1F7A4D' : SUB }}>
            {pin
              ? `Pinned at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)} — the caza is worked out from the nearest town.`
              : 'No pin yet — paste a link or tap the map.'}
          </p>

          {error && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={!pin || !name.trim() || busy}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: H }}
            >
              <MapPin className="h-4 w-4" /> {busy ? 'Saving…' : 'Save area'}
            </button>
            <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ border: '1.5px solid #EEF0F4', color: SUB }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
