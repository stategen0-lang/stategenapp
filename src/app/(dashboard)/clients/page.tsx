'use client'

import { useState } from 'react'
import { CLIENTS, CURRENT_AGENT_ID, getAgent, statusStyle, CLIENT_TYPE_STYLE, formatPrice, Client } from '@/lib/data'
import ClientDetailModal from '@/components/modals/ClientDetailModal'
import NewClientModal from '@/components/modals/NewClientModal'

export default function ClientsPage() {
  const [scope, setScope] = useState<'me' | 'company'>('company')
  const [list, setList] = useState<Client[]>(CLIENTS)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState('')

  const filtered = scope === 'me'
    ? list.filter(c => c.agentId === CURRENT_AGENT_ID)
    : list

  const detailClient = detailId != null ? list.find(c => c.id === detailId) ?? null : null
  const detailAgent = detailClient ? getAgent(detailClient.agentId) : null

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
            {filtered.map(c => {
              const agent = getAgent(c.agentId)
              const sc = statusStyle(c.status)
              const tc = CLIENT_TYPE_STYLE[c.type]
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
          const agent = getAgent(c.agentId)
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
        <ClientDetailModal client={detailClient} agent={detailAgent} onClose={() => setDetailId(null)} />
      )}
      {addOpen && (
        <NewClientModal
          onClose={() => setAddOpen(false)}
          onSaved={c => { setList(prev => [c, ...prev]); setAddOpen(false); showToast('Client saved!') }}
        />
      )}
    </div>
  )
}
