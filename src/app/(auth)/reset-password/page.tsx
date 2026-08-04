'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/brand/Logo'

// Where the password-reset email link lands. Supabase puts a recovery token in
// the URL, which the client exchanges for a short-lived session; we then let the
// user set a new password. (This route is allowlisted in proxy.ts so the page
// can load before that session cookie exists.)
export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [ready, setReady] = useState<boolean | null>(null) // null = checking
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // The recovery link fires PASSWORD_RECOVERY once the token is processed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    // Also handle the case where the session is already established.
    supabase.auth.getSession().then(({ data }) => {
      setReady(prev => prev ?? !!data.session)
    })
    // Give the URL-token exchange a moment before declaring the link invalid.
    const t = setTimeout(() => setReady(prev => prev ?? false), 3000)
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => { router.push('/dashboard'); router.refresh() }, 1500)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8"><Logo size={40} withWordmark /></div>

        {done ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#E3F4EA' }}>
              <CheckCircle2 className="h-7 w-7" style={{ color: '#1F7A4D' }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Password updated</h2>
            <p className="text-sm" style={{ color: '#7A8499' }}>Signing you in…</p>
          </div>
        ) : ready === false ? (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Link expired</h2>
            <p className="text-sm mb-6" style={{ color: '#7A8499' }}>
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Link href="/login" className="inline-block px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
              Back to sign in
            </Link>
          </div>
        ) : ready === null ? (
          <p className="text-sm text-center" style={{ color: '#7A8499' }}>Verifying your link…</p>
        ) : (
          <>
            <h2 className="text-2xl font-extrabold mb-1.5" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>Set a new password</h2>
            <p className="text-sm mb-7" style={{ color: '#6A7488' }}>Choose a new password for your account.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { label: 'New password', value: password, set: setPassword, ph: 'Min. 8 characters' },
                { label: 'Confirm password', value: confirm, set: setConfirm, ph: '••••••••' },
              ].map(({ label, value, set, ph }) => (
                <div key={label}>
                  <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>{label}</p>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                    <input
                      type="password" required value={value} onChange={e => set(e.target.value)} placeholder={ph}
                      className="w-full pl-10 pr-4 py-2.5 text-sm outline-none"
                      style={{ border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F' }}
                      onFocus={e => (e.target.style.borderColor = '#5E8FD6')}
                      onBlur={e => (e.target.style.borderColor = '#D7DCE5')}
                    />
                  </div>
                </div>
              ))}
              {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}
              <button type="submit" disabled={saving} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: '#0E1F3D' }}>
                {saving ? 'Saving…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
