'use client'

import { useState, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { getAgent, Property, Agent, PROPERTY_TYPES, propertyTypeLabel } from '@/lib/data'
import { filterProperties } from '@/lib/search'
import PropertyCard from '@/components/properties/MeridianPropertyCard'
import PropertyDetailModal from '@/components/modals/PropertyDetailModal'
import NewPropertyModal from '@/components/modals/NewPropertyModal'
import ImportModal from '@/components/import/ImportModal'
import { dbRowToProperty } from '@/lib/db-mappers'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

type AgentMap = Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>

// Module-scope caches so revisiting shows the last data instantly (revalidated
// in the background). Cleared on a full reload.
let PROPS_CACHE: Property[] | null = null
let PROP_AGENTS_CACHE: AgentMap | null = null

export default function PropertiesPage() {
  const [scope, setScope] = useState<'me' | 'company'>('company')
  const [list, setList] = useState<Property[]>(PROPS_CACHE ?? [])
  const [loaded, setLoaded] = useState(PROPS_CACHE != null)
  const [agents, setAgents] = useState<AgentMap>(PROP_AGENTS_CACHE ?? {})
  const { session } = useSession()

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    fetch('/api/properties', { signal: ctrl.signal })
      .then(r => { clearTimeout(t); return r.ok ? r.json() : Promise.reject(r.status) })
      .then(data => {
        // Always reflect the real result — even an empty one — so a new agency
        // sees its (empty) list, not leftover demo data.
        if (data.properties) { const m = data.properties.map(dbRowToProperty); PROPS_CACHE = m; setList(m) }
      })
      .catch(() => clearTimeout(t))
      .finally(() => setLoaded(true))
    // Real agent names/colours/WhatsApp, so listings show who they belong to.
    fetch('/api/company/agents').then(r => r.ok ? r.json() : null).then(d => { if (d?.agents) { PROP_AGENTS_CACHE = d.agents; setAgents(d.agents) } }).catch(() => {})
  }, [])

  // Real agent for a listing's code, falling back to the demo helper for codes
  // that predate their profile.
  const agentFor = (code: string): Agent => {
    const a = agents[code]
    return a
      ? { id: code as Agent['id'], name: a.name, initials: a.initials, color: a.color, shortName: a.name.split(' ')[0] }
      : getAgent(code as Agent['id'])
  }
  const [detailId, setDetailId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editProp, setEditProp] = useState<Property | null>(null)
  const [toast, setToast] = useState('')
  // Search + filters
  const [q, setQ] = useState('')
  const [fType, setFType] = useState('')
  const [fTxn, setFTxn] = useState('')
  const [fStatus, setFStatus] = useState('')

  async function reloadProperties() {
    const r = await fetch('/api/properties')
    if (r.ok) { const d = await r.json(); if (d.properties) { const m = d.properties.map(dbRowToProperty); PROPS_CACHE = m; setList(m) } }
  }

  function upsert(p: Property) {
    setList(prev => {
      const next = prev.some(x => x.id === p.id) ? prev.map(x => x.id === p.id ? p : x) : [p, ...prev]
      PROPS_CACHE = next
      return next
    })
  }

  // "Mine" means the signed-in agent's own listings (was hardcoded to 'a1').
  const scoped = scope === 'me'
    ? list.filter(p => session?.agentCode != null && p.agentId === session.agentCode)
    : list
  const filtered = filterProperties(scoped, { q, type: fType, transaction: fTxn, status: fStatus })
  const activeFilters = !!(q || fType || fTxn || fStatus)

  const detailProp = detailId != null ? list.find(p => p.id === detailId) ?? null : null
  const detailAgent = detailProp ? agentFor(detailProp.agentId) : null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>Properties</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: '#6A7488' }}>Manage your listings</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB' }}>
            {(['me','company'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="px-3 py-1.5 text-xs md:text-sm font-semibold transition-colors"
                style={scope === s ? { background: '#0E1F3D', color: '#fff' } : { background: 'transparent', color: '#6A7488' }}
              >
                {s === 'me' ? 'Mine' : 'All'}
              </button>
            ))}
          </div>
          {isManager(session?.role) && (
            <button
              onClick={() => setImportOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold"
              style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#0E1F3D' }}
            >
              Import
            </button>
          )}
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold text-white"
            style={{ background: '#0E1F3D' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9AA3B2' }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search listings — title, area, type…"
            className="w-full rounded-xl pl-9 pr-3 py-2 text-sm outline-none"
            style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#14223F' }}
          />
        </div>
        <select value={fType} onChange={e => setFType(e.target.value)} className="rounded-xl px-2.5 py-2 text-sm outline-none" style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: fType ? '#14223F' : '#6A7488' }}>
          <option value="">Any type</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{propertyTypeLabel(t)}</option>)}
        </select>
        <select value={fTxn} onChange={e => setFTxn(e.target.value)} className="rounded-xl px-2.5 py-2 text-sm outline-none" style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: fTxn ? '#14223F' : '#6A7488' }}>
          <option value="">Sale & rent</option>
          <option value="For Sale">For Sale</option>
          <option value="For Rent">For Rent</option>
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="rounded-xl px-2.5 py-2 text-sm outline-none" style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: fStatus ? '#14223F' : '#6A7488' }}>
          <option value="">Any status</option>
          {['Available', 'Pending', 'Reserved', 'Sold'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {activeFilters && (
          <button
            onClick={() => { setQ(''); setFType(''); setFTxn(''); setFStatus('') }}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: '#6A7488' }}
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      {activeFilters && (
        <p className="text-xs -mt-2" style={{ color: '#9AA3B2' }}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</p>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#9AA3B2' }}>
          <p className="text-base font-medium">No listings found</p>
          <p className="text-sm mt-1">{activeFilters ? 'Try clearing the search or filters' : 'Add a listing or switch to Company view'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => (
            <PropertyCard
              key={p.id}
              property={p}
              agent={agentFor(p.agentId)}
              onClick={() => setDetailId(p.id)}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 px-4 py-2.5 rounded-xl text-sm font-semibold text-white z-50"
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
          agentWhatsApp={agents[detailProp.agentId]?.whatsapp ?? null}
          isOwnListing={session?.agentCode != null && detailProp.agentId === session.agentCode}
          onClose={() => setDetailId(null)}
          onEdit={p => { setDetailId(null); setEditProp(p) }}
        />
      )}
      {addOpen && (
        <NewPropertyModal
          onClose={() => setAddOpen(false)}
          onSaved={p => {
            upsert(p)
            setAddOpen(false)
            showToast('Listing saved!')
          }}
        />
      )}
      {editProp && (
        <NewPropertyModal
          initial={editProp}
          onClose={() => setEditProp(null)}
          onSaved={p => {
            upsert(p)
            setEditProp(null)
            showToast('Changes saved!')
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          kind="properties"
          onClose={() => setImportOpen(false)}
          onDone={n => { setImportOpen(false); showToast(`Imported ${n} listing${n === 1 ? '' : 's'}!`); reloadProperties() }}
        />
      )}
    </div>
  )
}
