'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Building2, Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Status = 'loading' | 'ready' | 'submitting' | 'done' | 'error'

interface SessionInfo {
  companyName: string
  domain: string
  email: string
  planId: string
  customerId: string
  subscriptionId: string
}

export default function CompanyCompletePage() {
  const params = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const sessionId = params.get('session_id')

  const [status, setStatus]     = useState<Status>('loading')
  const [info, setInfo]         = useState<SessionInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')

  // Fetch and verify the Stripe session server-side via our API
  useEffect(() => {
    if (!sessionId) { setStatus('error'); setErrorMsg('No session ID in URL.'); return }

    fetch(`/api/stripe/session?session_id=${sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setStatus('error'); setErrorMsg(data.error); return }
        setInfo(data)
        setStatus('ready')
      })
      .catch(() => { setStatus('error'); setErrorMsg('Could not verify your payment. Contact support.') })
  }, [sessionId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!info) return
    if (password !== confirm) { setErrorMsg('Passwords do not match.'); return }
    if (password.length < 8) { setErrorMsg('Password must be at least 8 characters.'); return }
    setErrorMsg('')
    setStatus('submitting')

    try {
      // 1. Create Supabase auth user
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: info.email,
        password,
      })
      if (authErr) throw authErr
      if (!authData.user) throw new Error('Signup failed — please try again.')

      // 2. Upsert company (in case webhook hasn't fired yet)
      const { data: company, error: companyErr } = await supabase
        .from('Companies')
        .upsert(
          {
            Name: info.companyName,
            domain: info.domain,
            Plan: info.planId,
            'is active': true,
            stripe_customer_id: info.customerId || null,
            stripe_subscription_id: info.subscriptionId || null,
            stripe_status: 'active',
          },
          { onConflict: 'domain' }
        )
        .select()
        .single()
      if (companyErr) throw companyErr

      // 3. Create manager profile
      const { error: profileErr } = await supabase
        .from('Profiles')
        .insert({
          id: authData.user.id,
          company_id: company.id,
          Full_name: info.companyName + ' Manager',
          role: 'owner',
          approved: true,
        })
      if (profileErr) throw profileErr

      setStatus('done')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('ready')
    }
  }

  const inp = 'w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors'
  const inpStyle = { border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F', fontFamily: 'inherit', background: '#fff' }

  // ── Done ──
  if (status === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#E3F4EA' }}>
            <CheckCircle2 className="h-7 w-7" style={{ color: '#1F7A4D' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>You&apos;re all set!</h2>
          <p className="text-sm mb-2" style={{ color: '#7A8499' }}>
            <span className="font-semibold" style={{ color: '#1A2B4A' }}>{info?.companyName}</span> is now live on Meridian.
          </p>
          <p className="text-sm mb-6" style={{ color: '#7A8499' }}>
            Share your domain <span className="font-semibold" style={{ color: '#1A2B4A' }}>{info?.domain}</span> with your agents so they can request to join.
          </p>
          <button onClick={() => router.push('/login')} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
            Sign In →
          </button>
        </div>
      </div>
    )
  }

  // ── Hard error ──
  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#FBE7E7' }}>
            <AlertCircle className="h-7 w-7" style={{ color: '#A23434' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Something went wrong</h2>
          <p className="text-sm mb-6" style={{ color: '#7A8499' }}>{errorMsg}</p>
          <button onClick={() => router.push('/signup/company')} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
            ← Back to signup
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="w-full max-w-sm">
        {/* Payment confirmed banner */}
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-6" style={{ background: '#E3F4EA', border: '1px solid #B5DFC8' }}>
          <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#1F7A4D' }} />
          <p className="text-xs font-medium" style={{ color: '#1F7A4D' }}>
            Payment confirmed — one last step to activate your account.
          </p>
        </div>

        {status === 'loading' ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent mx-auto animate-spin" style={{ borderColor: '#5E8FD6', borderTopColor: 'transparent' }} />
            <p className="text-sm mt-3" style={{ color: '#7A8499' }}>Verifying payment…</p>
          </div>
        ) : (
          <>
            {/* Company summary */}
            {info && (
              <div className="rounded-2xl p-4 mb-6" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
                    <Building2 className="h-4 w-4" style={{ color: '#2E5288' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>{info.companyName}</p>
                    <p className="text-xs" style={{ color: '#7A8499' }}>{info.domain} · {info.planId} plan · {info.email}</p>
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>
              Almost done
            </p>
            <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
              Set your password
            </h2>
            <p className="text-sm mb-6" style={{ color: '#7A8499' }}>
              Choose a password for <span className="font-medium" style={{ color: '#1A2B4A' }}>{info?.email}</span>.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>Password</p>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                  <input className={inp} style={inpStyle} type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters"
                    onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
                </div>
              </div>

              <div>
                <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>Confirm password</p>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                  <input className={inp} style={inpStyle} type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••"
                    onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
                </div>
              </div>

              {errorMsg && (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{errorMsg}</p>
              )}

              <button type="submit" disabled={status === 'submitting'} className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60" style={{ background: '#0E1F3D' }}>
                {status === 'submitting' ? 'Creating account…' : 'Activate My Account →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
