'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Building2, Lock, Globe, User, ChevronLeft, CheckCircle2, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'pending'

function generateAgentCode(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0].slice(0, 2)).toUpperCase()
  const num = Math.floor(100 + Math.random() * 900)
  return `${initials}-${num}`
}

export default function AgentSignupPage() {
  const supabase = createClient()

  const [step, setStep]         = useState<Step>('form')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const [domain, setDomain]     = useState('')
  const [companyName, setCompanyName] = useState('')
  const [domainChecking, setDomainChecking] = useState(false)
  const [domainValid, setDomainValid]       = useState<boolean | null>(null)
  const [companyId, setCompanyId]           = useState<number | null>(null)

  const [fullName, setFullName]   = useState('')
  const [agentCode, setAgentCode] = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')

  // Re-generate code whenever name changes
  useEffect(() => {
    if (fullName.trim().length >= 2) {
      setAgentCode(generateAgentCode(fullName))
    } else {
      setAgentCode('')
    }
  }, [fullName])

  // Lookup company by domain (debounced)
  useEffect(() => {
    if (!domain || !domain.includes('.')) {
      setDomainValid(null)
      setCompanyName('')
      setCompanyId(null)
      return
    }
    const t = setTimeout(async () => {
      setDomainChecking(true)
      const { data, error } = await supabase
        .from('Companies')
        .select('id, Name')
        .eq('domain', domain.toLowerCase().trim())
        .maybeSingle()
      setDomainChecking(false)
      if (error || !data) {
        setDomainValid(false)
        setCompanyName('')
        setCompanyId(null)
      } else {
        setDomainValid(true)
        setCompanyName(data.Name)
        setCompanyId(data.id)
      }
    }, 600)
    return () => clearTimeout(t)
  }, [domain])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!domainValid || !companyId) { setError('Please enter a valid company domain.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!fullName.trim()) { setError('Please enter your full name.'); return }

    const syntheticEmail = `${agentCode.toLowerCase()}@${domain.toLowerCase().trim()}`

    setLoading(true)
    try {
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: syntheticEmail,
        password,
      })
      if (authErr) throw authErr
      if (!authData.user) throw new Error('Signup failed — please try again.')

      const { error: profileErr } = await supabase
        .from('Profiles')
        .insert({
          id: authData.user.id,
          company_id: companyId,
          Full_name: fullName.trim(),
          role: 'agent',
          agent_code: agentCode,
          approved: false,
        })
      if (profileErr) throw profileErr

      setStep('pending')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors'
  const inpStyle = { border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F', fontFamily: 'inherit', background: '#fff' }
  const labelStyle = { color: '#6A7488', letterSpacing: '0.5px' }

  if (step === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#FBEFD6' }}>
            <Clock className="h-7 w-7" style={{ color: '#9A6516' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Request sent!</h2>
          <p className="text-sm mb-5" style={{ color: '#7A8499' }}>
            Your account is pending approval by the manager of{' '}
            <span className="font-semibold" style={{ color: '#1A2B4A' }}>{companyName}</span>.
            You&apos;ll be able to sign in once they approve you.
          </p>

          {/* Agent code card */}
          <div className="rounded-2xl p-5 mb-6 text-left" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#5E8FD6' }}>
              Your agent credentials
            </p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: '#7A8499' }}>Agent ID</span>
                <span className="text-sm font-bold font-mono" style={{ color: '#1A2B4A' }}>{agentCode}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: '#7A8499' }}>Login email</span>
                <span className="text-xs font-medium" style={{ color: '#1A2B4A' }}>
                  {agentCode.toLowerCase()}@{domain}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: '#7A8499' }}>Company</span>
                <span className="text-xs font-medium" style={{ color: '#1A2B4A' }}>{companyName}</span>
              </div>
            </div>
            <p className="text-xs mt-3 pt-3" style={{ color: '#9AA3B2', borderTop: '1px solid #D8E2F0' }}>
              Save your Agent ID — you&apos;ll use it to sign in.
            </p>
          </div>

          <div className="flex items-start gap-2.5 p-3 rounded-xl mb-6 text-left" style={{ background: '#E3F4EA' }}>
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#1F7A4D' }} />
            <p className="text-xs" style={{ color: '#1F7A4D' }}>
              Your manager will receive a notification. Once approved, sign in with your Agent ID and password.
            </p>
          </div>

          <Link
            href="/login"
            className="block w-full py-3 rounded-xl text-sm font-semibold text-white text-center"
            style={{ background: '#0E1F3D' }}
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12" style={{ background: '#0E1F3D' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#5E8FD6' }}>
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">StateGen</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4" style={{ letterSpacing: '-0.3px' }}>
            Join your agency<br />on StateGen.
          </h1>
          <p className="text-sm mb-8" style={{ color: '#9DB2CC' }}>
            Your manager will review your request and approve your account before you can sign in.
          </p>
          <div className="space-y-4">
            {[
              { label: 'Enter your company domain', desc: 'Your manager shared this with you.' },
              { label: 'Set your name and password', desc: 'We auto-generate your unique agent ID.' },
              { label: 'Wait for approval', desc: 'Your manager approves you — then you\'re in.' },
            ].map(({ label, desc }, i) => (
              <div key={label} className="flex gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: '#5E8FD6', color: '#fff' }}>
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs" style={{ color: '#9DB2CC' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: '#6A7A94' }}>© 2026 StateGen · Agent Portal</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm">
          <Link href="/signup" className="inline-flex items-center gap-1.5 text-xs mb-6" style={{ color: '#7A8499' }}>
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </Link>

          <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={labelStyle}>Agent signup</p>
          <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
            Join your agency
          </h2>
          <p className="text-sm mb-7" style={{ color: '#7A8499' }}>
            Your manager will approve your request before you can log in.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Domain */}
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Company domain</p>
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  className={inp}
                  style={inpStyle}
                  required
                  value={domain}
                  onChange={e => setDomain(e.target.value.toLowerCase())}
                  placeholder="meridian.com"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={e => (e.target.style.borderColor = '#D7DCE5')}
                />
              </div>
              {/* Domain status */}
              <div className="mt-1.5 min-h-[18px]">
                {domainChecking && (
                  <p className="text-xs" style={{ color: '#9AA3B2' }}>Looking up company…</p>
                )}
                {!domainChecking && domainValid === true && (
                  <p className="text-xs font-medium flex items-center gap-1" style={{ color: '#1F7A4D' }}>
                    <CheckCircle2 className="h-3 w-3" /> Found: <span className="font-semibold">{companyName}</span>
                  </p>
                )}
                {!domainChecking && domainValid === false && (
                  <p className="text-xs" style={{ color: '#A23434' }}>No company found for this domain.</p>
                )}
              </div>
            </div>

            {/* Full name */}
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Your full name</p>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  className={inp}
                  style={inpStyle}
                  required
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Lara Khoury"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={e => (e.target.style.borderColor = '#D7DCE5')}
                />
              </div>
            </div>

            {/* Auto-generated agent ID preview */}
            {agentCode && (
              <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                <div>
                  <p className="text-xs" style={{ color: '#7A8499' }}>Your agent ID (auto-generated)</p>
                  <p className="text-base font-bold font-mono mt-0.5" style={{ color: '#1A2B4A' }}>{agentCode}</p>
                </div>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: '#5E8FD6' }}>
                  {agentCode.split('-')[0]}
                </div>
              </div>
            )}

            {/* Password */}
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Password</p>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  className={inp}
                  style={inpStyle}
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={e => (e.target.style.borderColor = '#D7DCE5')}
                />
              </div>
            </div>

            {/* Confirm */}
            <div>
              <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Confirm password</p>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                <input
                  className={inp}
                  style={inpStyle}
                  type="password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  onFocus={e => (e.target.style.borderColor = '#5E8FD6')}
                  onBlur={e => (e.target.style.borderColor = '#D7DCE5')}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !domainValid}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: '#0E1F3D' }}
            >
              {loading ? 'Submitting request…' : 'Request to Join →'}
            </button>

            <p className="text-xs text-center pt-1" style={{ color: '#9AA3B2' }}>
              Your manager will be notified and must approve your account before you can sign in.
            </p>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: '#9AA3B2' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold" style={{ color: '#5E8FD6' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
