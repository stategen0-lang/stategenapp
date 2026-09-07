'use client'

import { useState, useEffect } from 'react'
import { getAgent, statusStyle, CLIENT_TYPE_STYLE, formatPrice, tagStyle, Client, Agent } from '@/lib/data'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import { sortOwnFirst } from '@/lib/client-order'
import ClientDetailModal from '@/components/modals/ClientDetailModal'
import NewClientModal from '@/components/modals/NewClientModal'
import BulkForwardModal from '@/components/modals/BulkForwardModal'
import ImportModal from '@/components/import/ImportModal'
import { dbRowToClient } from '@/lib/db-mappers'

type AgentMap = Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>

// Module-scope caches: revisiting the page shows the last data instantly while
// it revalidates in the background. Cleared on a full reload.
let CLIENTS_CACHE: Client[] | null = null
let AGENTS_CACHE: AgentMap | null = null

export default function ClientsPage() {
  const [scope, setScope] = useState<'me' | 'company'>('company')
  const [list, setList] = useState<Client[]>(CLIENTS_CACHE ?? [])
  const [loaded, setLoaded] = useState(CLIENTS_CACHE != null)
  const [agents, setAgents] = useState<AgentMap>(AGENTS_CACHE ?? {})
  const { session } = useSession()

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    fetch('/api/clients', { signal: ctrl.signal })
      .then(r => { clearTimeout(t); return r.ok ? r.json() : Promise.reject(r.status) })
      .then(data => {
        // Always reflect the real result (even empty) — no leftover demo data.
        if (data.clients) { const m = data.clients.map(dbRowToClient); CLIENTS_CACHE = m; setList(m) }
      })
      .catch(() => clearTimeout(t))
      .finally(() => setLoaded(true))
    // Real agent names/colours for avatars (falls back to the demo helper).
    fetch('/api/company/agents').then(r => r.ok ? r.json() : null).then(d => { if (d?.agents) { AGENTS_CACHE = d.agents; setAgents(d.agents) } }).catch(() => {})
  }, [])

  const agentFor = (code: string): Agent => {
    const a = agents[code]
    return a
      ? { id: code as Agent['id'], name: a.name, initials: a.initials, color: a.color, shortName: a.name.split(' ')[0] }
      : getAgent(code as Agent['id'])
  }
  const [detailId, setDetailId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  async function reloadClients() {
    const r = await fetch('/api/clients')
    if (r.ok) { const d = await r.json(); if (d.clients) { const m = d.clients.map(dbRowToClient); CLIENTS_CACHE = m; setList(m) } }
  }

  function upsert(c: Client) {
    setList(prev => {
      const next = prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]
      CLIENTS_CACHE = next
      return next
    })
  }

  // "Mine" means the signed-in agent's own clients (was hardcoded to 'a1').
  // Under "All", an agent's own clients are floated to the top of the list,
  // with the rest of the company's below them.
  const scoped = scope === 'me'
    ? list.filter(c => session?.agentCode != null && c.agentId === session.agentCode)
    : sortOwnFirst(list, session?.agentCode)
  const filtered = tagFilter ? scoped.filter(c => (c.tags ?? []).includes(tagFilter)) : scoped

  // Every tag currently in use, for the filter bar. Cleared automatically if the
  // active filter no longer applies to any visible client.
  const allTags = [...new Set(scoped.flatMap(c => c.tags ?? []))].sort((a, b) => a.localeCompare(b))

  // Recipients a bulk-forward can actually reach: the agent's own clients with a
  // phone (masked, other-agent clients have no phone and are never messaged).
  const forwardTargets = filtered.filter(c => !c.masked && c.phone)

  const detailClient = detailId != null ? list.find(c => c.id === detailId) ?? null : null
  const detailAgent = detailClient ? agentFor(detailClient.agentId) : null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>Clients</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: '#6A7488' }}>Manage client requests and matches</p>
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
          {forwardTargets.length > 0 && (
            <button
              onClick={() => setForwardOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold"
              style={{ border: '1.5px solid #EEF0F4', background: '#fff', color: '#0E1F3D' }}
              title={tagFilter ? `Forward a listing to your ${tagFilter} clients` : 'Forward a listing to these clients'}
            >
              Forward{tagFilter ? ` · ${forwardTargets.length}` : ''}
            </button>
          )}
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

      {/* Tag filter bar — only shown once tags exist */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-1">
          <button
            onClick={() => setTagFilter(null)}
            className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
            style={!tagFilter ? { background: '#0E1F3D', color: '#fff' } : { background: '#F2F4F7', color: '#6A7488' }}
          >
            All
          </button>
          {allTags.map(t => {
            const on = tagFilter === t
            const s = tagStyle(t)
            return (
              <button
                key={t}
                onClick={() => setTagFilter(on ? null : t)}
                className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                style={on ? { background: s.color, color: '#fff' } : { background: s.bg, color: s.color }}
              >
                {t}
              </button>
            )
          })}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block rounded-2xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #EEF0F4', background: '#F7F8FB' }}>
              {['Client','Type','Status','Budget','Agent'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold" style={{ color: '#9AA3B2', letterSpacing: '0.05em' }}>
                  {h.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loaded && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm" style={{ color: '#9AA3B2' }}>
                  {scope === 'me' ? 'You have no clients yet.' : 'No clients yet — add your first client to get started.'}
                </td>
              </tr>
            )}
            {filtered.map(c => {
              const agent = agentFor(c.agentId)
              const sc = statusStyle(c.status)
              const tc = CLIENT_TYPE_STYLE[c.type] ?? { bg: '#F0F2F5', color: '#6A7488' }
              const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              return (
                <tr key={c.id} onClick={() => setDetailId(c.id)} className="cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid #F4F5F8' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FAFBFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{initials}</div>
                      <div>
                        <p className="font-semibold" style={{ color: '#14223F' }}>{c.name}</p>
                        <p className="text-xs" style={{ color: '#9AA3B2' }}>{c.phone}</p>
                        {(c.tags?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.tags!.map(t => {
                              const s = tagStyle(t)
                              return <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{t}</span>
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>{c.type}</span></td>
                  <td className="px-4 py-3"><span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{c.status}</span></td>
                  <td className="px-4 py-3 font-semibold" style={{ color: '#14223F' }}>{formatPrice(c.budget)}</td>
                  <td className="px-4 py-3 text-xs font-medium" style={{ color: '#6A7488' }}>{agent.shortName}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: '#9AA3B2' }}>No clients found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden rounded-2xl overflow-hidden bg-white" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        {filtered.length === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: '#9AA3B2' }}>No clients found</p>
        )}
        {filtered.map(c => {
          const agent = agentFor(c.agentId)
          const sc = statusStyle(c.status)
          const tc = CLIENT_TYPE_STYLE[c.type]
          const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
          return (
            <div key={c.id} onClick={() => setDetailId(c.id)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer active:bg-gray-50"
              style={{ borderBottom: '1px solid #F4F5F8' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: agent.color }}>{initials}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: '#14223F' }}>{c.name}</p>
                <p className="text-xs truncate" style={{ color: '#9AA3B2' }}>{c.phone}</p>
                {(c.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.tags!.slice(0, 3).map(t => {
                      const s = tagStyle(t)
                      return <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{t}</span>
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>{c.type}</span>
                <p className="text-xs font-semibold" style={{ color: '#14223F' }}>{formatPrice(c.budget)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 px-4 py-2.5 rounded-xl text-sm font-semibold text-white z-50"
          style={{ background: '#1F7A4D', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {detailClient && detailAgent && (
        <ClientDetailModal
          client={detailClient}
          agent={detailAgent}
          onClose={() => setDetailId(null)}
          onEdit={detailClient.masked ? undefined : c => { setDetailId(null); setEditClient(c) }}
          onStatusChange={(id, status) => setList(prev => prev.map(x => x.id === id ? { ...x, status } : x))}
          onReferred={() => { reloadClients(); showToast('Client referred') }}
        />
      )}
      {addOpen && (
        <NewClientModal
          onClose={() => setAddOpen(false)}
          onSaved={c => { upsert(c); setAddOpen(false); showToast('Client saved!') }}
        />
      )}
      {importOpen && (
        <ImportModal
          kind="clients"
          onClose={() => setImportOpen(false)}
          onDone={n => { setImportOpen(false); showToast(`Imported ${n} client${n === 1 ? '' : 's'}!`); reloadClients() }}
        />
      )}
      {forwardOpen && (
        <BulkForwardModal
          clients={forwardTargets}
          tagLabel={tagFilter}
          onClose={() => setForwardOpen(false)}
        />
      )}
      {editClient && (
        <NewClientModal
          initial={editClient}
          onClose={() => setEditClient(null)}
          onSaved={c => { upsert(c); setEditClient(null); showToast('Changes saved!') }}
        />
      )}
    </div>
  )
}
