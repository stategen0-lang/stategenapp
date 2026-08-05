'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Mail, Lock } from 'lucide-react'
import Logo from '@/components/brand/Logo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // StateGen operators go to the admin panel, not a company dashboard.
    const me = await fetch('/api/me').then(r => r.ok ? r.json() : null).catch(() => null)
    router.push(me?.session?.isPlatformAdmin ? '/admin' : '/dashboard')
    router.refresh()
  }

  async function handleReset() {
    setError(null)
    if (!email.trim()) {
      setError('Enter your email above first, then tap “Forgot password?”.')
      return
    }
    setResetting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetting(false)
    // Don't reveal whether an email exists — always show the same confirmation.
    if (error && !/rate/i.test(error.message)) { setError(error.message); return }
    setResetSent(true)
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: '#0E1F3D' }}
      >
        <Logo variant="white" size={34} withWordmark priority />

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
          {/* The navy panel carrying the logo is desktop-only, so brand the
              form itself on phones — otherwise sign-in has no logo at all. */}
          <div className="lg:hidden mb-8">
            <Logo variant="navy" size={44} withWordmark priority />
          </div>

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
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
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
              <div className="flex justify-end mt-1.5">
                <button type="button" onClick={handleReset} disabled={resetting} className="text-xs disabled:opacity-50" style={{ color: '#5E8FD6' }}>
                  {resetting ? 'Sending…' : 'Forgot password?'}
                </button>
              </div>
            </div>

            {resetSent && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>
                If an account exists for that email, we&apos;ve sent a password reset link. Check your inbox.
              </p>
            )}

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>
                {error}
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
          <p className="text-center text-xs mt-4" style={{ color: '#9AA3B2' }}>
            <Link href="/terms" style={{ color: '#9AA3B2', textDecoration: 'underline' }}>Terms</Link>
            {' · '}
            <Link href="/privacy" style={{ color: '#9AA3B2', textDecoration: 'underline' }}>Privacy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
