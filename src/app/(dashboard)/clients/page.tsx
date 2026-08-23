'use client'

import { useState, useEffect } from 'react'
import { getAgent, statusStyle, CLIENT_TYPE_STYLE, formatPrice, Client, Agent } from '@/lib/data'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import { sortOwnFirst } from '@/lib/client-order'
import ClientDetailModal from '@/components/modals/ClientDetailModal'
import NewClientModal from '@/components/modals/NewClientModal'
import ImportModal from '@/components/import/ImportModal'
import { dbRowToClient } from '@/lib/db-mappers'

export default function ClientsPage() {
  const [scope, setScope] = useState<'me' | 'company'>('company')
  const [list, setList] = useState<Client[]>([])
  const [loaded, setLoaded] = useState(false)
  const [agents, setAgents] = useState<Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>>({})
  const { session } = useSession()

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    fetch('/api/clients', { signal: ctrl.signal })
      .then(r => { clearTimeout(t); return r.ok ? r.json() : Promise.reject(r.status) })
      .then(data => {
        // Always reflect the real result (even empty) — no leftover demo data.
        if (data.clients) setList(data.clients.map(dbRowToClient))
      })
      .catch(() => clearTimeout(t))
      .finally(() => setLoaded(true))
    // Real agent names/colours for avatars (falls back to the demo helper).
    fetch('/api/company/agents').then(r => r.ok ? r.json() : null).then(d => { if (d?.agents) setAgents(d.agents) }).catch(() => {})
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
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [toast, setToast] = useState('')

  async function reloadClients() {
    const r = await fetch('/api/clients')
    if (r.ok) { const d = await r.json(); if (d.clients) setList(d.clients.map(dbRowToClient)) }
  }

  function upsert(c: Client) {
    setList(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev])
  }

  // "Mine" means the signed-in agent's own clients (was hardcoded to 'a1').
  // Under "All", an agent's own clients are floated to the top of the list,
  // with the rest of the company's below them.
  const filtered = scope === 'me'
    ? list.filter(c => session?.agentCode != null && c.agentId === session.agentCode)
    : sortOwnFirst(list, session?.agentCode)

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
