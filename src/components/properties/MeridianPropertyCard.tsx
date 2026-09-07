'use client'

import { Property, Agent, TYPE_GRADIENTS, statusStyle, formatPrice } from '@/lib/data'

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
        style={{ background: TYPE_GRADIENTS[p.type] }}
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
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.28)', color: '#fff' }}>
              {p.type} · {p.transaction}
            </span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: sc.bg, color: sc.color }}
            >
              {p.status}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">{p.title}</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.78)' }}>{p.district}, {p.city}</p>
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

        <div className="flex flex-wrap gap-2">
          {p.beds > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#F0F2F5', color: '#6A7488' }}>
              🛏 {p.beds} bed
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#F0F2F5', color: '#6A7488' }}>
            🚿 {p.baths} bath
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#F0F2F5', color: '#6A7488' }}>
            {p.size} m²
          </span>
          {p.view && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#F0F2F5', color: '#6A7488' }}>
              👁 {p.view}
            </span>
          )}
          {p.garden && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>
              🌿 Garden
            </span>
          )}
          {p.balcony && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
              🏠 Balcony
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
