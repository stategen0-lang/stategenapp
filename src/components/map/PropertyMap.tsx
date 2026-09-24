'use client'

// The inventory on a map.
//
// Every listing already carries an area, and the gazetteer knows where every
// area is, so this needed no new data — only the two things an agent asks that
// a list cannot answer: where is our stock, and what else do we have near this
// one.
//
// Leaflet is loaded on demand (dynamic import, in an effect) rather than at the
// top of the file: the properties page must not pay for a map that most visits
// never open. Its CSS comes the same way.
//
// Listings that share a point — everything filed to the same area centre —
// become one numbered marker, because forty pins stacked on Achrafieh look like
// one listing. Pins the agent placed themselves are drawn solid; pins that are
// only "somewhere in this area" are drawn hollow, so the map never implies a
// precision it does not have.

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import type { Property } from '@/lib/data'
import { loadAreas, type AreaIndex } from '@/lib/lebanon/areas'
import { propertyPoint, clusterPoints, boundsOf, statusColor, type PointCluster } from '@/lib/property-geo'

const H = '#14223F'
const SUB = '#6A7488'

interface Props {
  properties: Property[]
  /** Opens the listing sheet, the same one the cards open. */
  onSelect: (id: number) => void
}

/** The marker itself: a coloured disc, numbered when it holds more than one. */
function markerHtml(c: PointCluster): string {
  const count = c.properties.length
  const color = count > 1 ? H : statusColor(c.properties[0].status)
  const size = count > 1 ? 30 : 20
  // A hollow centre means "somewhere in this area" rather than "here".
  const fill = c.exact ? color : '#ffffff'
  const text = c.exact ? '#ffffff' : color
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${fill};border:2.5px solid ${color};
    box-shadow:0 1px 4px rgba(0,0,0,0.35);
    display:flex;align-items:center;justify-content:center;
    font:700 11px/1 ui-sans-serif,system-ui,sans-serif;color:${text}">${count > 1 ? count : ''}</div>`
}

const money = (n: number) => `$${Math.round(n || 0).toLocaleString('en-US')}`

const priceOf = (p: Property) =>
  p.transaction === 'For Rent'
    ? (p.rent > 0 ? `${money(p.rent)}/mo` : 'Price on request')
    : (p.price > 0 ? money(p.price) : 'Price on request')

/** What a marker says when it is clicked. */
function popupHtml(c: PointCluster): string {
  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rows = c.properties.slice(0, 12).map(p => `
    <button data-listing="${p.id}" style="
      display:block;width:100%;text-align:left;padding:7px 8px;border:0;border-radius:8px;
      background:transparent;cursor:pointer;font:inherit">
      <div style="font-weight:700;color:${H};font-size:13px">${esc(p.title)}</div>
      <div style="color:${SUB};font-size:12px">${esc(p.type)} · ${esc(priceOf(p))}</div>
    </button>`).join('')

  const more = c.properties.length > 12
    ? `<div style="padding:6px 8px;color:${SUB};font-size:12px">+ ${c.properties.length - 12} more here</div>`
    : ''

  const header = c.properties.length > 1
    ? `<div style="padding:2px 8px 6px;font-weight:700;color:${H};font-size:12px">
         ${c.properties.length} listings${c.exact ? '' : ' in this area'}</div>`
    : ''

  return `<div style="min-width:190px;max-height:260px;overflow:auto">${header}${rows}${more}</div>`
}

export default function PropertyMap({ properties, onSelect }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const markers = useRef<Marker[]>([])
  const [ix, setIx] = useState<AreaIndex | null>(null)
  const [failed, setFailed] = useState(false)
  // State, not just the ref: the map is created asynchronously, and if the
  // gazetteer resolves first the redraw below would run against a map that does
  // not exist yet and never be asked again. This is what re-asks it.
  const [ready, setReady] = useState(false)
  // Kept in a ref so redrawing markers doesn't need the callback in its deps.
  const select = useRef(onSelect)
  select.current = onSelect

  // The gazetteer: without it only pinned listings can be placed.
  useEffect(() => {
    let live = true
    loadAreas().then(loaded => { if (live) setIx(loaded) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  // Create the map once.
  useEffect(() => {
    let live = true
    let created: LeafletMap | null = null

    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        await import('leaflet/dist/leaflet.css')
        if (!live || !holder.current || map.current) return

        created = L.map(holder.current, { scrollWheelZoom: true, attributionControl: true })
          // All of Lebanon until there is something to fit to.
          .setView([33.89, 35.6], 8)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(created)
        map.current = created
        // The holder is laid out by the time this runs, but Leaflet measured it
        // when it was created; without this it draws a single tile.
        created.invalidateSize()
        setReady(true)
      } catch {
        if (live) setFailed(true)
      }
    })()

    return () => {
      live = false
      map.current?.remove()
      map.current = null
      created?.remove()
    }
  }, [])

  // Redraw whenever the filtered list or the gazetteer changes.
  useEffect(() => {
    if (!ready || !map.current) return
    let live = true

    ;(async () => {
      const L = (await import('leaflet')).default
      if (!live || !map.current) return

      markers.current.forEach(mk => mk.remove())
      markers.current = []

      const points = properties
        .map(p => propertyPoint(p, ix))
        .filter((p): p is NonNullable<typeof p> => p !== null)
      const clusters = clusterPoints(points)

      for (const c of clusters) {
        const marker = L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            html: markerHtml(c),
            className: '',   // Leaflet's default adds a white box behind the disc
            iconSize: c.properties.length > 1 ? [30, 30] : [20, 20],
            iconAnchor: c.properties.length > 1 ? [15, 15] : [10, 10],
          }),
        }).addTo(map.current)

        marker.bindPopup(popupHtml(c), { closeButton: true, autoPan: true })
        // A single listing opens straight away; a cluster shows its list first.
        marker.on('click', () => { if (c.properties.length === 1) select.current(c.properties[0].id) })
        markers.current.push(marker)
      }

      const box = boundsOf(points)
      if (box) {
        map.current.fitBounds([[box.south, box.west], [box.north, box.east]], { padding: [40, 40], maxZoom: 15 })
      }
    })()

    return () => { live = false }
  }, [properties, ix, ready])

  // The popup's rows are plain HTML, so one delegated listener opens the sheet.
  useEffect(() => {
    const el = holder.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-listing]')
      const id = Number(btn?.getAttribute('data-listing'))
      if (id) select.current(id)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [])

  const placed = ix ? properties.filter(p => propertyPoint(p, ix)).length : 0
  const missing = properties.length - placed

  if (failed) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ border: '1.5px dashed #EEF0F4', color: SUB }}>
        <p className="text-sm font-semibold" style={{ color: H }}>The map could not load</p>
        <p className="text-xs mt-1">Check the connection and try again — the list view still works offline.</p>
      </div>
    )
  }

  return (
    <div>
      <div ref={holder} className="rounded-2xl overflow-hidden"
        style={{ height: 'clamp(340px, 70vh, 620px)', border: '1.5px solid #EEF0F4', background: '#EEF2F7' }} />
      <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]" style={{ color: SUB }}>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: statusColor('Available'), display: 'inline-block' }} />
          exact pin
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: '#fff', border: `2px solid ${statusColor('Available')}`, display: 'inline-block' }} />
          somewhere in the area
        </span>
        {/* Said plainly: a map that quietly drops listings is worse than none. */}
        {missing > 0 && (
          <span>
            {missing} listing{missing === 1 ? '' : 's'} not shown — {missing === 1 ? 'its area is' : 'their areas are'} not one we can place.
          </span>
        )}
      </div>
    </div>
  )
}
