'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Mail, Globe, Lock, ChevronLeft } from 'lucide-react'

export default function CompanySignupPage() {
  const router = useRouter()

  const [companyName, setCompanyName] = useState('')
  const [domain, setDomain]           = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const inp = 'w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors'
  const inpStyle = { border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F', fontFamily: 'inherit', background: '#fff' }
  const labelStyle = { color: '#6A7488', letterSpacing: '0.5px' }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!domain.includes('.')) { setError('Please enter a valid domain (e.g. myagency.com).'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/signup/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, domain: domain.toLowerCase(), email, planId: 'business', password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Signup failed — please try again.')
      router.push('/signup/company/complete')
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || JSON.stringify(err) || 'Something went wrong.'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 flex-col justify-between p-12" style={{ background: '#0E1F3D' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#5E8FD6' }}>
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">StateGen</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4" style={{ letterSpacing: '-0.3px' }}>
            Register your<br />agency.
          </h1>
          <p className="text-sm mb-8" style={{ color: '#9DB2CC' }}>
            Your domain links your whole team. Agents sign up under it and you approve each one.
          </p>
          <div className="space-y-3">
            {[
              'Register your company',
              'We activate your account after payment',
              'Invite agents under your domain',
            ].map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#5E8FD6', color: '#fff' }}>
                  {i + 1}
                </div>
                <span className="text-sm" style={{ color: '#C8D6EA' }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: '#6A7A94' }}>© 2026 StateGen · Agent Portal</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-y-auto" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm">
          <Link href="/signup" className="inline-flex items-center gap-1.5 text-xs mb-6" style={{ color: '#7A8499' }}>
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </Link>

          <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={labelStyle}>Manager signup</p>
          <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
            Register your company
          </h2>
          <p className="text-sm mb-7" style={{ color: '#7A8499' }}>
            Your account will be activated once we confirm your subscription.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Company name</p>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input className={inp} style={inpStyle} required value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="My Agency"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Company domain</p>
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input className={inp} style={inpStyle} required value={domain} onChange={e => setDomain(e.target.value.toLowerCase())} placeholder="myagency.com"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
              </div>
              <p className="text-xs mt-1" style={{ color: '#9AA3B2' }}>Agents sign up under this domain.</p>
            </div>

            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Your email</p>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input className={inp} style={inpStyle} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@myagency.com"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Password</p>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input className={inp} style={inpStyle} type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Confirm password</p>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input className={inp} style={inpStyle} type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
              </div>
            </div>

            {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

            <button type="submit" disabled={loading} className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60" style={{ background: '#0E1F3D' }}>
              {loading ? 'Creating account…' : 'Create Account →'}
            </button>
          </form>

          <p className="text-center text-xs mt-6" style={{ color: '#9AA3B2' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold" style={{ color: '#5E8FD6' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
