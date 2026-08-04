'use client'

import { useEffect, useState } from 'react'
import { UserCheck, Check, X, Clock, Users, Trash2 } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

type Agent = { id: string; Full_name: string | null; agent_code: string | null; created_at: string }

const H = '#1A2B4A'
const SUB = '#7A8499'

function initials(name: string | null) {
  return (name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function TeamPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)

  const [pending, setPending] = useState<Agent[] | null>(null)
  const [active, setActive] = useState<Agent[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Agent | null>(null)

  async function load() {
    const r = await fetch('/api/agents').then(x => x.ok ? x.json() : null).catch(() => null)
    setPending(r?.pending ?? [])
    setActive(r?.active ?? [])
  }
  useEffect(() => { load() }, [])

  async function act(id: string, action: 'approve' | 'reject' | 'remove') {
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Something went wrong.'); return }
      setConfirmRemove(null)
      await load()
    } finally { setBusy(null) }
  }

  if (session && !manager) {
    return <div className="p-8"><p className="text-sm" style={{ color: SUB }}>Only managers can manage the team.</p></div>
  }

  const card = { boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' } as const

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <div className="flex items-center gap-2.5 mb-1.5">
          <Users className="h-6 w-6" style={{ color: '#2E5288' }} />
          <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Team</h1>
        </div>
        <p className="text-sm" style={{ color: SUB }}>Approve new agents and manage who has access to your agency.</p>
      </div>

      {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

      {/* ── Pending approvals ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <UserCheck className="h-4 w-4" style={{ color: '#8A5A12' }} />
          <p className="text-sm font-bold" style={{ color: H }}>Pending approvals{pending && pending.length > 0 ? ` (${pending.length})` : ''}</p>
        </div>
        <div className="rounded-2xl bg-white overflow-hidden" style={card}>
          {pending === null ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>Loading…</p>
          ) : pending.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>No pending requests. New sign-ups appear here.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
              {pending.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: '#5E8FD6' }}>{initials(a.Full_name)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: H }}>{a.Full_name || 'Unnamed agent'}</p>
                      <p className="text-xs flex items-center gap-1.5" style={{ color: SUB }}>
                        <span className="font-mono">{a.agent_code}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(a.created_at).toLocaleDateString()}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => act(a.id, 'reject')} disabled={busy === a.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}>
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                    <button onClick={() => act(a.id, 'approve')} disabled={busy === a.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50" style={{ background: '#1B8A4B' }}>
                      <Check className="h-3.5 w-3.5" /> {busy === a.id ? '…' : 'Approve'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Active agents ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Users className="h-4 w-4" style={{ color: '#2E5288' }} />
          <p className="text-sm font-bold" style={{ color: H }}>Active agents{active.length > 0 ? ` (${active.length})` : ''}</p>
        </div>
        <div className="rounded-2xl bg-white overflow-hidden" style={card}>
          {pending === null ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>Loading…</p>
          ) : active.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>No active agents yet. Approved agents appear here.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
              {active.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: '#2E5288' }}>{initials(a.Full_name)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: H }}>{a.Full_name || 'Unnamed agent'}</p>
                      <p className="text-xs font-mono" style={{ color: SUB }}>{a.agent_code}</p>
                    </div>
                  </div>
                  <button onClick={() => setConfirmRemove(a)} disabled={busy === a.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: SUB }}>Removing an agent revokes their access and frees a seat. Their listings and clients stay with the agency.</p>
      </div>

      {/* ── Remove confirmation ── */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,31,61,0.45)' }} onClick={e => e.target === e.currentTarget && setConfirmRemove(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <p className="text-base font-bold" style={{ color: H }}>Remove {confirmRemove.Full_name || 'this agent'}?</p>
            <p className="text-sm mt-1.5 mb-5" style={{ color: SUB }}>
              They&apos;ll immediately lose access and their seat is freed. Their listings and clients remain with the agency. This can&apos;t be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRemove(null)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ border: '1.5px solid #D7DCE5', color: H }}>Cancel</button>
              <button onClick={() => act(confirmRemove.id, 'remove')} disabled={busy === confirmRemove.id} className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#A23434' }}>
                {busy === confirmRemove.id ? 'Removing…' : 'Remove agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
