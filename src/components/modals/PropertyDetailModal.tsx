'use client'

import { useState } from 'react'
import { Property, Agent, Client, TYPE_GRADIENTS, statusStyle, formatPrice, buildDesc, getAgent } from '@/lib/data'
import MatchCards from '@/components/matching/MatchCards'
import ClientDetailModal from './ClientDetailModal'

interface Props {
  property: Property
  agent: Agent
  onClose: () => void
  onEdit?: (p: Property) => void
}

export default function PropertyDetailModal({ property: p, agent, onClose, onEdit }: Props) {
  const sc = statusStyle(p.status)
  const photos = p.photos ?? []
  const [activePhoto, setActivePhoto] = useState(0)
  const [stackedClient, setStackedClient] = useState<Client | null>(null)

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
        style={{ background: 'rgba(14,31,61,0.5)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div
          className="w-full md:max-w-lg md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col"
          style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.2)', maxHeight: '92vh' }}
        >
          {/* ── Main photo / gradient hero ── */}
          <div className="relative shrink-0" style={{ height: 200 }}>
            {photos.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photos[activePhoto]} alt={p.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{ background: TYPE_GRADIENTS[p.type] }} />
            )}

            <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(0,0,0,0.35)', color: '#fff', backdropFilter: 'blur(4px)' }}
              >
                {p.type} · {p.transaction}
              </span>
              <div className="flex items-center gap-2">
                {onEdit && (
                  <button
                    onClick={() => onEdit(p)}
                    className="h-7 px-3 rounded-full flex items-center justify-center text-white text-xs font-semibold leading-none"
                    style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm leading-none"
                  style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div
              className="absolute bottom-0 left-0 right-0 px-4 py-3"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }}
            >
              <p className="text-base font-bold text-white leading-tight">{p.title}</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {p.district}, {p.city}
              </p>
            </div>
          </div>

          {/* ── Photo gallery strip ── */}
          {photos.length > 1 && (
            <div className="flex gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid #EEF0F4', background: '#F7F8FB' }}>
              {photos.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setActivePhoto(i)}
                  className="shrink-0 rounded-lg overflow-hidden"
                  style={{
                    width: 56, height: 40,
                    border: i === activePhoto ? '2px solid #5E8FD6' : '2px solid transparent',
                    opacity: i === activePhoto ? 1 : 0.65,
                    transition: 'all 0.15s',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {photos.length === 0 && (
            <div className="flex gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid #EEF0F4', background: '#F7F8FB' }}>
              <p className="text-xs italic" style={{ color: '#9AA3B2' }}>No photos uploaded yet</p>
            </div>
          )}

          {/* ── Scrollable body ── */}
          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-2xl font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>
                {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
              </p>
              <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                {p.status}
              </span>
            </div>

            {/* pre-wrap: template descriptions are multi-line with headings and
                bullet lists, which would otherwise collapse into one paragraph */}
            <p className="text-sm leading-relaxed" style={{ color: '#6A7488', whiteSpace: 'pre-wrap' }}>{buildDesc(p)}</p>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Size',      value: `${p.size} m²` },
                { label: 'Bedrooms',  value: p.beds > 0 ? String(p.beds) : 'N/A' },
                { label: 'Bathrooms', value: String(p.baths) },
                { label: 'View',      value: p.view || '—' },
                { label: 'Garden',    value: p.garden ? 'Yes' : 'No' },
                { label: 'Balcony',   value: p.balcony ? 'Yes' : 'No' },
                ...(p.parkings ? [{ label: 'Parking', value: String(p.parkings) }] : []),
                ...(p.buildingAge ? [{ label: 'Building Age', value: `${p.buildingAge} yrs` }] : []),
                ...(p.needsRenovation ? [{ label: 'Renovation', value: 'Needed' }] : []),
                ...(p.advancedPayment ? [{ label: 'Advanced pay', value: p.advancedPayment }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                  <p className="text-xs" style={{ color: '#9AA3B2' }}>{label}</p>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: '#14223F' }}>{value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid #EEF0F4' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ background: agent.color }}
              >
                {agent.initials}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#14223F' }}>Listed by {agent.name}</p>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>StateGen</p>
              </div>
            </div>

            {/* ── AI Matching ── */}
            <div style={{ borderTop: '1px solid #EEF0F4', paddingTop: 16 }}>
              <MatchCards
                entityType="property"
                entity={p}
                onOpenClient={c => setStackedClient(c)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stacked client modal — comes later in DOM so renders above at same z-index */}
      {stackedClient && (
        <ClientDetailModal
          client={stackedClient}
          agent={getAgent(stackedClient.agentId)}
          onClose={() => setStackedClient(null)}
        />
      )}
    </>
  )
}
