'use client'

import type { LucideIcon } from 'lucide-react'
import { Maximize2, BedDouble, Bath, SquareParking, Eye, Waves, Mountain, Sun, Fence, Trees } from 'lucide-react'
import { Property, Agent, TYPE_GRADIENTS, statusStyle, formatPrice, propertyLocation } from '@/lib/data'

interface Fact { key: string; label: string; title: string; Icon: LucideIcon; tone: 'plain' | 'blue' | 'green' }

/** The card's badges, in display order. Empty facts are left out. */
function facts(p: Property): Fact[] {
  const out: Fact[] = []
  if (p.size > 0) out.push({ key: 'size', label: `${p.size} m²`, title: 'Area', Icon: Maximize2, tone: 'plain' })
  if (p.beds > 0) out.push({ key: 'beds', label: `${p.beds} bed`, title: 'Bedrooms', Icon: BedDouble, tone: 'plain' })
  if (p.baths > 0) out.push({ key: 'baths', label: `${p.baths} bath`, title: 'Bathrooms', Icon: Bath, tone: 'plain' })
  if ((p.parkings ?? 0) > 0) out.push({ key: 'parking', label: `${p.parkings} parking`, title: 'Parking spaces', Icon: SquareParking, tone: 'plain' })
  if (p.view) {
    const v = p.view.toLowerCase()
    const Icon = /sea|river|lake/.test(v) ? Waves : /mountain|valley|forest/.test(v) ? Mountain : Eye
    out.push({ key: 'view', label: p.view, title: `${p.view} view`, Icon, tone: 'plain' })
  }
  if (p.terrace) out.push({ key: 'terrace', label: 'Terrace', title: 'Terrace', Icon: Sun, tone: 'blue' })
  if (p.balcony) out.push({ key: 'balcony', label: 'Balcony', title: 'Balcony', Icon: Fence, tone: 'blue' })
  if (p.garden) out.push({ key: 'garden', label: 'Garden', title: 'Garden', Icon: Trees, tone: 'green' })
  return out
}

interface Props {
  property: Property
  agent: Agent
  onClick: () => void
}

export default function PropertyCard({ property: p, agent, onClick }: Props) {
  const sc = statusStyle(p.status)

  return (
    <div
      onClick={onClick}
      className="rounded-2xl overflow-hidden cursor-pointer flex flex-col"
      style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: '1px solid #EEF0F4', transition: 'box-shadow 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.11)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.07)')}
    >
      {/* Header — the listing photo when there is one, else the type gradient */}
      <div
        className="h-28 relative overflow-hidden"
        style={{ background: TYPE_GRADIENTS[p.type] ?? 'linear-gradient(135deg,#16294A,#2E5288)' }}
      >
        {p.photos?.[0] && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photos[0]} alt="" className="absolute inset-0 w-full h-full object-cover" />
            {/* Scrim so the white chips/title stay legible over any photo */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,20,40,0.30) 0%, rgba(10,20,40,0.62) 100%)' }} />
          </>
        )}
        <div className="relative h-full px-4 pt-3 pb-3 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.28)', color: '#fff' }}>
                {p.type} · {p.transaction}
              </span>
              {p.video && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.28)', color: '#fff' }} title="Has a video walkthrough">
                  🎥
                </span>
              )}
            </div>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: sc.bg, color: sc.color }}
            >
              {p.status}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">{p.title}</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.78)' }}>{propertyLocation(p)}</p>
          </div>
        </div>
        {/* Agent initials */}
        <div
          className="absolute bottom-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ background: agent.color, boxShadow: '0 0 0 2px rgba(255,255,255,0.35)' }}
          title={agent.name}
        >
          {agent.initials}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex flex-col gap-2">
        <p className="text-base font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.3px' }}>
          {p.transaction === 'For Rent'
            ? `${formatPrice(p.rent)}/mo`
            : formatPrice(p.price)}
        </p>

        {/* Facts, in the order agents scan them: size, rooms, parking, view, outdoor. */}
        <div className="flex flex-wrap gap-1.5">
          {facts(p).map(f => (
            <span key={f.key} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: f.tone === 'plain' ? '#F0F2F5' : f.tone === 'green' ? '#E3F4EA' : '#EAF0FA', color: f.tone === 'plain' ? '#6A7488' : f.tone === 'green' ? '#1F7A4D' : '#2E5288' }}
              title={f.title}>
              <f.Icon className="h-3 w-3 shrink-0" aria-hidden />
              {f.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
