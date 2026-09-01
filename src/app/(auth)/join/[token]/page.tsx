'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock, User, Lock } from 'lucide-react'

// Agent-facing single-use invite acceptance. Validates the token, collects a
// name + password, and (on success) signs the agent straight in — no manager
// approval step, because the manager already issued the link.
export default function JoinPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token ?? '')
  const router = useRouter()
  const supabase = createClient()

  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [companyName, setCompanyName] = useState('')
  const [invalidMsg, setInvalidMsg] = useState('')

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d.ok) { setCompanyName(d.companyName); setState('ready') }
        else { setInvalidMsg(d.error || 'This invite link is not valid.'); setState('invalid') }
      })
      .catch(() => { if (alive) { setInvalidMsg('Could not check this invite link. Please try again.'); setState('invalid') } })
    return () => { alive = false }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fullName: fullName.trim(), password }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error || 'Could not join. Please try again.'); setBusy(false); return }
      // Sign straight in with the credentials we just created, then go in.
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: d.email, password })
      if (signErr) {
        // Account exists and is approved — worst case they sign in manually.
        router.push('/login')
        return
      }
      router.push('/dashboard')
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
    }
  }

  const inp = 'w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors'
  const inpStyle = { border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F', fontFamily: 'inherit', background: '#fff' }
  const labelStyle = { color: '#6A7488', letterSpacing: '0.5px' }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
      <div className="w-full max-w-sm">
        {state === 'checking' && (
          <p className="text-center text-sm" style={{ color: '#7A8499' }}>Checking your invite…</p>
        )}

        {state === 'invalid' && (
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#FBE7E7' }}>
              <Clock className="h-7 w-7" style={{ color: '#A23434' }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Invite unavailable</h2>
            <p className="text-sm mb-6" style={{ color: '#7A8499' }}>{invalidMsg}</p>
            <Link href="/login" className="block w-full py-3 rounded-xl text-sm font-semibold text-white text-center" style={{ background: '#0E1F3D' }}>Go to sign in</Link>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#E3F4EA' }}>
                <CheckCircle2 className="h-7 w-7" style={{ color: '#1F7A4D' }} />
              </div>
              <h2 className="text-xl font-bold" style={{ color: '#1A2B4A' }}>Join {companyName}</h2>
              <p className="text-sm mt-1" style={{ color: '#7A8499' }}>Set up your agent account — you&apos;ll be signed in right away.</p>
            </div>

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Full name</p>
                <div className="relative">
                  <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9AA3B2' }} />
                  <input className={inp} style={inpStyle} required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Password</p>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9AA3B2' }} />
                  <input className={inp} style={inpStyle} required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Confirm password</p>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9AA3B2' }} />
                  <input className={inp} style={inpStyle} required type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" />
                </div>
              </div>

              {error && <p className="text-xs" style={{ color: '#A23434' }}>{error}</p>}

              <button type="submit" disabled={busy} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>
                {busy ? 'Setting up…' : 'Join & sign in'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
