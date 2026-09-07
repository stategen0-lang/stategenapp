'use client'

import { useEffect, useState } from 'react'
import { UserCheck, Check, X, Clock, Users, Trash2, Shield, ShieldCheck, ShieldOff, Link2, Copy, Plus, KeyRound } from 'lucide-react'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

type Agent = { id: string; Full_name: string | null; agent_code: string | null; role?: string; created_at: string }
type ActionKind = 'remove' | 'promote' | 'demote'

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
  const [managers, setManagers] = useState<Agent[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ agent: Agent; action: ActionKind } | null>(null)

  // Invite links + direct onboarding
  type Invite = { id: string; token: string; created_at: string; expires_at: string | null }
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ fullName: '', password: '' })
  const [addBusy, setAddBusy] = useState(false)
  const [addResult, setAddResult] = useState<{ email: string; agentCode: string; password: string } | null>(null)
  const [addErr, setAddErr] = useState('')
  const [resetFor, setResetFor] = useState<Agent | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetDone, setResetDone] = useState<string | null>(null)
  const [resetErr, setResetErr] = useState('')

  async function load() {
    const r = await fetch('/api/agents').then(x => x.ok ? x.json() : null).catch(() => null)
    setPending(r?.pending ?? [])
    setActive(r?.active ?? [])
    setManagers(r?.managers ?? [])
    setMeId(r?.meId ?? null)
  }
  async function loadInvites() {
    const r = await fetch('/api/invites').then(x => x.ok ? x.json() : null).catch(() => null)
    setInvites(r?.invites ?? [])
  }
  useEffect(() => { load(); loadInvites() }, [])

  const inviteUrl = (token: string) => (typeof window !== 'undefined' ? `${window.location.origin}/join/${token}` : `/join/${token}`)
  function copy(text: string) {
    try { navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(c => (c === text ? null : c)), 1500) } catch { /* ignore */ }
  }
  // A readable temporary password when the manager doesn't type one.
  function genPassword() { return `sg-${Math.random().toString(36).slice(2, 8)}${Math.floor(10 + Math.random() * 90)}` }

  async function createInvite() {
    setInviteBusy(true); setError(null)
    try {
      const r = await fetch('/api/invites', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Could not create an invite link.'); return }
      await loadInvites()
      copy(inviteUrl(j.invite.token))
    } finally { setInviteBusy(false) }
  }
  async function revokeInvite(id: string) {
    setInvites(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/invites?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }
  async function createAgent() {
    setAddBusy(true); setAddErr('')
    try {
      const password = addForm.password.trim() || genPassword()
      const r = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', fullName: addForm.fullName.trim(), password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setAddErr(j.error || 'Could not create the agent.'); return }
      setAddResult({ email: j.email, agentCode: j.agentCode, password })
      await load()
    } finally { setAddBusy(false) }
  }
  async function resetPassword() {
    if (!resetFor) return
    setResetBusy(true); setResetErr('')
    try {
      const password = resetPw.trim() || genPassword()
      const r = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', id: resetFor.id, password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setResetErr(j.error || 'Could not reset the password.'); return }
      setResetDone(password)
    } finally { setResetBusy(false) }
  }

  async function act(id: string, action: 'approve' | 'reject' | ActionKind) {
    setBusy(id); setError(null)
    try {
      const r = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Something went wrong.'); return }
      setConfirm(null)
      await load()
    } finally { setBusy(null) }
  }

  if (session && !manager) {
    return <div className="p-8"><p className="text-sm" style={{ color: SUB }}>Only managers can manage the team.</p></div>
  }

  const card = { boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' } as const

  // A manager can be turned back into an agent only when it won't leave the
  // company manager-less, it isn't you, and they have an agent profile to return
  // to (an owner who never had a code can't become an agent).
  const canDemote = (m: Agent) => managers.length > 1 && m.id !== meId && !!m.agent_code

  const confirmCopy: Record<ActionKind, { title: string; body: string; cta: string; danger: boolean }> = {
    remove: {
      title: `Remove ${confirm?.agent.Full_name || 'this agent'}?`,
      body: 'They’ll immediately lose access and their seat is freed. Their listings and clients remain with the agency. This can’t be undone.',
      cta: 'Remove agent', danger: true,
    },
    promote: {
      title: `Make ${confirm?.agent.Full_name || 'this agent'} a manager?`,
      body: 'They’ll get full manager access — approve agents, see every client, and assign work — while keeping their own listings and clients. You can change this back later.',
      cta: 'Make manager', danger: false,
    },
    demote: {
      title: `Make ${confirm?.agent.Full_name || 'this manager'} an agent?`,
      body: 'They’ll lose manager access and only see their own clients and listings again. Their records stay with them.',
      cta: 'Make agent', danger: false,
    },
  }

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <div className="flex items-center gap-2.5 mb-1.5">
          <Users className="h-6 w-6" style={{ color: '#2E5288' }} />
          <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Team</h1>
        </div>
        <p className="text-sm" style={{ color: SUB }}>Approve new agents, promote partners to managers, and manage who has access to your agency.</p>
      </div>

      {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

      {/* ── Add agents (invite link or direct) ── */}
      <div className="rounded-2xl bg-white p-4" style={card}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold" style={{ color: H }}>Add an agent</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Send a one-time invite link, or create the account yourself.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={createInvite} disabled={inviteBusy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #CFE0F5', background: '#F5F9FE', color: '#2E5288' }}>
              <Link2 className="h-3.5 w-3.5" /> {inviteBusy ? 'Creating…' : 'Create invite link'}
            </button>
            <button onClick={() => { setAddOpen(true); setAddForm({ fullName: '', password: '' }); setAddResult(null); setAddErr('') }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white" style={{ background: '#0E1F3D' }}>
              <Plus className="h-3.5 w-3.5" /> Add directly
            </button>
          </div>
        </div>

        {invites.length > 0 && (
          <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid #EEF0F4' }}>
            <p className="text-xs font-semibold" style={{ color: SUB }}>Active invite links — each works once, then stops:</p>
            {invites.map(iv => {
              const url = inviteUrl(iv.token)
              return (
                <div key={iv.id} className="flex items-center gap-2">
                  <code className="flex-1 text-xs px-2.5 py-2 rounded-lg truncate" style={{ background: '#F7F8FB', color: '#2E5288', border: '1px solid #EEF0F4' }}>{url}</code>
                  <button onClick={() => copy(url)} className="text-xs font-bold px-2.5 py-2 rounded-lg flex items-center gap-1" style={{ border: '1.5px solid #EEF0F4', color: H }}>
                    <Copy className="h-3.5 w-3.5" /> {copied === url ? 'Copied' : 'Copy'}
                  </button>
                  <button onClick={() => revokeInvite(iv.id)} className="text-xs font-bold px-2.5 py-2 rounded-lg" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}>Revoke</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Managers ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Shield className="h-4 w-4" style={{ color: '#2E5288' }} />
          <p className="text-sm font-bold" style={{ color: H }}>Managers{managers.length > 0 ? ` (${managers.length})` : ''}</p>
        </div>
        <div className="rounded-2xl bg-white overflow-hidden" style={card}>
          {managers.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: SUB }}>Loading…</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
              {managers.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: '#1A2B4A' }}>{initials(m.Full_name)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate flex items-center gap-2" style={{ color: H }}>
                        {m.Full_name || 'Unnamed manager'}
                        {m.id === meId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>You</span>}
                      </p>
                      <p className="text-xs flex items-center gap-1" style={{ color: SUB }}>
                        <ShieldCheck className="h-3 w-3" /> Manager{m.agent_code ? <span className="font-mono ml-1">· {m.agent_code}</span> : null}
                      </p>
                    </div>
                  </div>
                  {canDemote(m) && (
                    <button onClick={() => setConfirm({ agent: m, action: 'demote' })} disabled={busy === m.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #D7DCE5', color: H }}>
                      <ShieldOff className="h-3.5 w-3.5" /> Make agent
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => { setResetFor(a); setResetPw(''); setResetDone(null); setResetErr('') }} title="Reset password" className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold" style={{ border: '1.5px solid #D7DCE5', color: H }}>
                      <KeyRound className="h-3.5 w-3.5" /> Password
                    </button>
                    <button onClick={() => setConfirm({ agent: a, action: 'promote' })} disabled={busy === a.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #CFE0F5', background: '#F5F9FE', color: '#2E5288' }}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Manager
                    </button>
                    <button onClick={() => setConfirm({ agent: a, action: 'remove' })} disabled={busy === a.id} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50" style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: SUB }}>Promoting a partner to manager keeps their listings and clients. Removing an agent frees a seat; their records stay with the agency.</p>
      </div>

      {/* ── Confirmation ── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,31,61,0.45)' }} onClick={e => e.target === e.currentTarget && setConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <p className="text-base font-bold" style={{ color: H }}>{confirmCopy[confirm.action].title}</p>
            <p className="text-sm mt-1.5 mb-5" style={{ color: SUB }}>{confirmCopy[confirm.action].body}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ border: '1.5px solid #D7DCE5', color: H }}>Cancel</button>
              <button
                onClick={() => act(confirm.agent.id, confirm.action)}
                disabled={busy === confirm.agent.id}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: confirmCopy[confirm.action].danger ? '#A23434' : '#1B8A4B' }}
              >
                {busy === confirm.agent.id ? 'Working…' : confirmCopy[confirm.action].cta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add agent directly ── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,31,61,0.45)' }} onClick={e => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <p className="text-base font-bold mb-1" style={{ color: H }}>Add an agent</p>
            {addResult ? (
              <>
                <p className="text-sm mb-3" style={{ color: SUB }}>Account created and approved. Give the agent these details:</p>
                <div className="rounded-xl p-3 space-y-1.5" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                  {([['Login email', addResult.email], ['Agent ID', addResult.agentCode], ['Password', addResult.password]] as const).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span className="text-xs" style={{ color: SUB }}>{k}</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: H }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => copy(`Login: ${addResult.email}\nPassword: ${addResult.password}`)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ border: '1.5px solid #D7DCE5', color: H }}>{copied?.startsWith('Login:') ? 'Copied' : 'Copy'}</button>
                  <button onClick={() => setAddOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: '#0E1F3D' }}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm mb-3" style={{ color: SUB }}>They&apos;re added and approved immediately — no sign-up or waiting.</p>
                <div className="space-y-2.5">
                  <input autoFocus value={addForm.fullName} onChange={e => setAddForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Agent full name" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: '1.5px solid #D7DCE5', color: H }} />
                  <input value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password (leave blank to auto-generate)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: '1.5px solid #D7DCE5', color: H }} />
                </div>
                {addErr && <p className="text-xs mt-2" style={{ color: '#A23434' }}>{addErr}</p>}
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => setAddOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ border: '1.5px solid #D7DCE5', color: H }}>Cancel</button>
                  <button onClick={createAgent} disabled={addBusy || !addForm.fullName.trim()} className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>{addBusy ? 'Creating…' : 'Create agent'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Reset an agent's password ── */}
      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,31,61,0.45)' }} onClick={e => e.target === e.currentTarget && setResetFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <p className="text-base font-bold mb-1" style={{ color: H }}>Reset password</p>
            {resetDone ? (
              <>
                <p className="text-sm mb-3" style={{ color: SUB }}>Done. Give <span className="font-semibold" style={{ color: H }}>{resetFor.Full_name || 'the agent'}</span> their new password:</p>
                <div className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                  <span className="text-sm font-mono font-bold" style={{ color: H }}>{resetDone}</span>
                  <button onClick={() => copy(resetDone)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ border: '1.5px solid #D7DCE5', color: H }}>{copied === resetDone ? 'Copied' : 'Copy'}</button>
                </div>
                <div className="flex justify-end mt-4">
                  <button onClick={() => setResetFor(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: '#0E1F3D' }}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm mb-3" style={{ color: SUB }}>Set a new password for <span className="font-semibold" style={{ color: H }}>{resetFor.Full_name || 'this agent'}</span> and relay it to them.</p>
                <input autoFocus value={resetPw} onChange={e => setResetPw(e.target.value)} placeholder="New password (leave blank to auto-generate)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: '1.5px solid #D7DCE5', color: H }} />
                {resetErr && <p className="text-xs mt-2" style={{ color: '#A23434' }}>{resetErr}</p>}
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => setResetFor(null)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ border: '1.5px solid #D7DCE5', color: H }}>Cancel</button>
                  <button onClick={resetPassword} disabled={resetBusy} className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>{resetBusy ? 'Resetting…' : 'Reset password'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
