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
import { MapPin, X } from 'lucide-react'
import type { Map as LeafletMap, Marker } from 'leaflet'

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

        created.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          const { lat, lng } = e.latlng
          setPin({ lat, lng })
          setError('')
          if (marker.current) marker.current.setLatLng([lat, lng])
          else marker.current = L.marker([lat, lng], {
            icon: L.divIcon({
              className: '',
              html: `<div style="width:20px;height:20px;border-radius:50%;background:${H};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.4)"></div>`,
              iconSize: [20, 20], iconAnchor: [10, 10],
            }),
          }).addTo(created!)
        })

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
              Tap the map where it is. Everyone in your agency can use it from then on.
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

          <div ref={holder} className="rounded-xl overflow-hidden"
            style={{ height: 'clamp(240px, 42vh, 380px)', border: '1.5px solid #EEF0F4', background: '#EEF2F7' }} />

          <p className="text-xs" style={{ color: pin ? '#1F7A4D' : SUB }}>
            {pin
              ? `Pinned at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)} — the caza is worked out from the nearest town.`
              : 'No pin yet — tap the map to place one.'}
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
