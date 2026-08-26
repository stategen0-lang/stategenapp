'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import Logo from '@/components/brand/Logo'

// Supabase sometimes hands back an empty or object-shaped error; never surface a
// bare "{}" — fall back to a human message.
function cleanMsg(m: unknown, fallback: string): string {
  const s = typeof m === 'string' ? m.trim() : ''
  if (!s || s === '{}' || s === '[object Object]') return fallback
  return s
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // A password-reset link redirects to the site origin (Supabase forces the
  // Site URL), so it can land here rather than on /reset-password. Forward the
  // recovery token — hash intact — to the reset screen, which completes it. The
  // event listener is a fallback if the client consumed the token before we ran.
  useEffect(() => {
    if (typeof window !== 'undefined' && /type=recovery|error=/.test(window.location.hash)) {
      window.location.replace('/reset-password' + window.location.hash)
      return
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password')
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Email a password-reset link to whatever's in the email field. Lands on
  // /reset-password, which completes the recovery flow.
  async function handleForgot() {
    setError(null); setResetMsg(null)
    if (!email.trim()) { setError('Enter your email above first, then tap "Forgot password?".'); return }
    setResetting(true)
    const redirectTo = `${window.location.origin}/reset-password`
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) { setError(cleanMsg(error.message, 'Could not send the reset email. Please try again.')); return }
      setResetMsg(`If an account exists for ${email.trim()}, a reset link is on its way. Check your email.`)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setResetting(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResetMsg(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })

      if (error) {
        setError(cleanMsg(error.message, 'Invalid email or password.'))
        setLoading(false)
        return
      }

      // Check if the user's company is active
      if (data.user) {
        const { data: profile } = await supabase
          .from('Profiles')
          .select('company_id')
          .eq('id', data.user.id)
          .single()

        if (profile?.company_id) {
          const { data: company } = await supabase
            .from('Companies')
            .select('"is active"')
            .eq('id', profile.company_id)
            .single()

          if (company && !company['is active']) {
            await supabase.auth.signOut()
            setError('Your account is pending activation. We will contact you once your subscription is confirmed.')
            setLoading(false)
            return
          }
        }
      }

      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: '#0E1F3D' }}
      >
        <Logo variant="white" size={40} withWordmark priority />

        <div>
          <h1 className="text-4xl font-extrabold text-white leading-tight mb-4" style={{ letterSpacing: '-0.5px' }}>
            The property intelligence<br />platform for agents.
          </h1>
          <p className="text-base mb-10" style={{ color: '#9DB2CC' }}>
            Capture a client&apos;s brief in seconds and let StateGen surface<br />
            the listings — across the whole agency — that actually fit.
          </p>

          <div className="space-y-4">
            {[
              'Smart matching scored on 8 criteria',
              'Shared agency inventory & clients',
              'Live commission & performance tracking',
            ].map((feat) => (
              <div key={feat} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: '#5E8FD6' }} />
                <span className="text-sm" style={{ color: '#C8D6EA' }}>{feat}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs" style={{ color: '#6A7A94' }}>
          © 2026 StateGen · Agent Portal
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-sm">
          <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>
            AGENT SIGN IN
          </p>
          <h2 className="text-2xl font-extrabold mb-1.5" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>
            Welcome back
          </h2>
          <p className="text-sm mb-8" style={{ color: '#6A7488' }}>
            Use the credentials issued by your agency admin.
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>
                Email address
              </p>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@agency.com"
                  className="w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors"
                  style={{
                    border: '1.5px solid #D7DCE5',
                    borderRadius: '10px',
                    color: '#14223F',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={(e) => (e.target.style.borderColor = '#D7DCE5')}
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>
                Password
              </p>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-2.5 text-sm outline-none transition-colors"
                  style={{
                    border: '1.5px solid #D7DCE5',
                    borderRadius: '10px',
                    color: '#14223F',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={(e) => (e.target.style.borderColor = '#D7DCE5')}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-gray-100 transition-colors"
                  style={{ color: '#9AA3B2' }}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex justify-end mt-1.5">
                <button type="button" onClick={handleForgot} disabled={resetting} className="text-xs disabled:opacity-60" style={{ color: '#5E8FD6' }}>
                  {resetting ? 'Sending…' : 'Forgot password?'}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>
                {error}
              </p>
            )}
            {resetMsg && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>
                {resetMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ background: '#0E1F3D' }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          <p className="text-center text-xs mt-7" style={{ color: '#9AA3B2' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-semibold" style={{ color: '#5E8FD6' }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
