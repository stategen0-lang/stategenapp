'use client'

import { useState } from 'react'
import {
  PROPERTIES, AGENTS, CURRENT_AGENT_ID, getAgent, Property,
} from '@/lib/data'
import MeridianPropertyCard from '@/components/properties/MeridianPropertyCard'
import PropertyDetailModal from '@/components/modals/PropertyDetailModal'
import NewPropertyModal from '@/components/modals/NewPropertyModal'

export default function PropertiesPage() {
  const [scope, setScope] = useState<'me' | 'company'>('company')
  const [list, setList] = useState<Property[]>(PROPERTIES)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState('')

  const filtered = scope === 'me'
    ? list.filter(p => p.agentId === CURRENT_AGENT_ID)
    : list

  const detailProp = detailId != null ? list.find(p => p.id === detailId) ?? null : null
  const detailAgent = detailProp ? getAgent(detailProp.agentId) : null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>Properties</h1>
          <p className="text-sm mt-0.5" style={{ color: '#6A7488' }}>Manage your listings</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Scope toggle */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB' }}>
            {(['me','company'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="px-4 py-1.5 text-sm font-semibold transition-colors"
                style={scope === s
                  ? { background: '#0E1F3D', color: '#fff' }
                  : { background: 'transparent', color: '#6A7488' }}
              >
                {s === 'me' ? 'My listings' : 'Company'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: '#0E1F3D' }}
          >
            + Add listing
          </button>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#9AA3B2' }}>
          <p className="text-base font-medium">No listings found</p>
          <p className="text-sm mt-1">Add a listing or switch to Company view</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => (
            <MeridianPropertyCard
              key={p.id}
              property={p}
              agent={getAgent(p.agentId)}
              onClick={() => setDetailId(p.id)}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-sm font-semibold text-white z-50"
          style={{ background: '#1F7A4D', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
        >
          {toast}
        </div>
      )}

      {/* Modals */}
      {detailProp && detailAgent && (
        <PropertyDetailModal
          property={detailProp}
          agent={detailAgent}
          onClose={() => setDetailId(null)}
        />
      )}
      {addOpen && (
        <NewPropertyModal
          onClose={() => setAddOpen(false)}
          onSaved={p => {
            setList(prev => [p, ...prev])
            setAddOpen(false)
            showToast('Listing saved!')
          }}
        />
      )}
    </div>
  )
}
