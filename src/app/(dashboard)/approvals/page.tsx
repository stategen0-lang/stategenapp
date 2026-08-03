'use client'

import { useEffect, useState } from 'react'
import { UserCheck, Check, X, Clock } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

type Pending = { id: string; Full_name: string | null; agent_code: string | null; created_at: string }

const H = '#1A2B4A'
const SUB = '#7A8499'

export default function ApprovalsPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)

  const [pending, setPending] = useState<Pending[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch('/api/agents').then(x => x.ok ? x.json() : null).catch(() => null)
    setPending(r?.pending ?? [])
  }
  useEffect(() => { load() }, [])

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Something went wrong.'); return }
      setPending(p => (p ?? []).filter(x => x.id !== id))
    } finally { setBusy(null) }
  }

  if (session && !manager) {
    return <div className="p-8"><p className="text-sm" style={{ color: SUB }}>Only managers can review agent approvals.</p></div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-8">
      <div className="flex items-center gap-2.5 mb-1.5">
        <UserCheck className="h-6 w-6" style={{ color: '#2E5288' }} />
        <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Agent approvals</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: SUB }}>
        Agents who signed up under your agency&apos;s domain and are waiting to be let in.
      </p>

      {error && <p className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        {pending === null ? (
          <p className="px-5 py-8 text-sm text-center" style={{ color: SUB }}>Loading…</p>
        ) : pending.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: '#F0F2F5' }}>
              <Check className="h-6 w-6" style={{ color: '#6A7488' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: H }}>No pending requests</p>
            <p className="text-xs mt-1" style={{ color: SUB }}>New agent sign-ups will appear here for approval.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
            {pending.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: '#5E8FD6' }}>
                    {(a.Full_name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: H }}>{a.Full_name || 'Unnamed agent'}</p>
                    <p className="text-xs flex items-center gap-1.5" style={{ color: SUB }}>
                      <span className="font-mono">{a.agent_code}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(a.created_at).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => act(a.id, 'reject')}
                    disabled={busy === a.id}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                    style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                  <button
                    onClick={() => act(a.id, 'approve')}
                    disabled={busy === a.id}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: '#1B8A4B' }}
                  >
                    <Check className="h-3.5 w-3.5" /> {busy === a.id ? '…' : 'Approve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
