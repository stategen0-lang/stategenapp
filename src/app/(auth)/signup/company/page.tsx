'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Building2, Mail, Globe, ChevronLeft, Check, Zap } from 'lucide-react'
import { PLANS, PlanId } from '@/lib/stripe-plans'

type Step = 'info' | 'plan'

export default function CompanySignupPage() {
  const params = useSearchParams()
  const cancelled = params.get('cancelled') === '1'

  const [step, setStep]           = useState<Step>('info')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('pro')

  const [companyName, setCompanyName] = useState('')
  const [domain, setDomain]           = useState('')
  const [email, setEmail]             = useState('')

  function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!domain.includes('.')) { setError('Please enter a valid domain (e.g. meridian.com).'); return }
    setStep('plan')
  }

  async function handleCheckout() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, domain, email, planId: selectedPlan }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to create checkout session.')
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  const inp = 'w-full pl-10 pr-4 py-2.5 text-sm outline-none transition-colors'
  const inpStyle = { border: '1.5px solid #D7DCE5', borderRadius: '10px', color: '#14223F', fontFamily: 'inherit', background: '#fff' }
  const labelStyle = { color: '#6A7488', letterSpacing: '0.5px' }

  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 flex-col justify-between p-12" style={{ background: '#0E1F3D' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#5E8FD6' }}>
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">Meridian</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4" style={{ letterSpacing: '-0.3px' }}>
            {step === 'info' ? <>Register your<br />agency.</> : <>Choose the right<br />plan for you.</>}
          </h1>
          <p className="text-sm mb-8" style={{ color: '#9DB2CC' }}>
            {step === 'info'
              ? 'Your domain links your whole team. Choose it carefully — agents sign up under it.'
              : 'All plans include smart matching, the full CRM, and commission tracking. Upgrade any time.'}
          </p>
          <div className="space-y-2">
            {[
              { label: 'Company info', done: step === 'plan' },
              { label: 'Choose plan & pay', done: false },
              { label: 'Set password & activate', done: false },
            ].map((s, i) => (
              <div key={s.label} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: s.done ? '#1F8A5B' : i === (step === 'info' ? 0 : 1) ? '#5E8FD6' : 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {s.done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className="text-sm" style={{ color: i === (step === 'info' ? 0 : 1) ? '#fff' : '#9DB2CC' }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: '#6A7A94' }}>© 2026 Meridian Estates · Agent Portal</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-y-auto" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-lg">
          <Link href="/signup" className="inline-flex items-center gap-1.5 text-xs mb-6" style={{ color: '#7A8499' }}>
            <ChevronLeft className="h-3.5 w-3.5" />
            {step === 'plan' ? <span onClick={e => { e.preventDefault(); setStep('info') }} className="cursor-pointer">Back</span> : 'Back'}
          </Link>

          {cancelled && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-5" style={{ background: '#FBE7E7', border: '1px solid #F5C0C0' }}>
              <p className="text-xs" style={{ color: '#A23434' }}>Payment was cancelled. You can try again below.</p>
            </div>
          )}

          {/* ── STEP 1: Company info ── */}
          {step === 'info' && (
            <>
              <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={labelStyle}>Manager signup · Step 1 of 3</p>
              <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
                Register your company
              </h2>
              <p className="text-sm mb-7" style={{ color: '#7A8499' }}>
                You&apos;ll set your password after payment.
              </p>

              <form onSubmit={handleInfoSubmit} className="space-y-4">
                <div>
                  <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Company name</p>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                    <input className={inp} style={inpStyle} required value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Meridian Estates"
                      onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Company domain</p>
                  <div className="relative">
                    <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                    <input className={inp} style={inpStyle} required value={domain} onChange={e => setDomain(e.target.value.toLowerCase())} placeholder="meridian.com"
                      onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
                  </div>
                  <p className="text-xs mt-1" style={{ color: '#9AA3B2' }}>Agents sign up under this domain.</p>
                </div>

                <div>
                  <p className="text-xs font-bold tracking-wider mb-1.5 uppercase" style={labelStyle}>Your email</p>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9AA3B2' }} />
                    <input className={inp} style={inpStyle} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@meridian.com"
                      onFocus={e => (e.target.style.borderColor = '#5E8FD6')} onBlur={e => (e.target.style.borderColor = '#D7DCE5')} />
                  </div>
                </div>

                {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

                <button type="submit" className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
                  Choose a plan →
                </button>
              </form>

              <p className="text-center text-xs mt-6" style={{ color: '#9AA3B2' }}>
                Already have an account?{' '}
                <Link href="/login" className="font-semibold" style={{ color: '#5E8FD6' }}>Sign in</Link>
              </p>
            </>
          )}

          {/* ── STEP 2: Plan selection ── */}
          {step === 'plan' && (
            <>
              <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={labelStyle}>Manager signup · Step 2 of 3</p>
              <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
                Choose your plan
              </h2>
              <p className="text-sm mb-7" style={{ color: '#7A8499' }}>
                All plans include a 14-day free trial. Cancel any time.
              </p>

              <div className="space-y-3 mb-6">
                {PLANS.map(plan => {
                  const active = selectedPlan === plan.id
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className="w-full text-left rounded-2xl p-4 transition-all relative"
                      style={{
                        border: active ? '2px solid #5E8FD6' : '2px solid #EEF0F4',
                        background: active ? '#F5F8FE' : '#fff',
                        boxShadow: active ? '0 0 0 3px rgba(94,143,214,0.12)' : '0 1px 3px rgba(0,0,0,0.05)',
                      }}
                    >
                      {'popular' in plan && plan.popular && (
                        <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex items-center gap-1" style={{ background: '#5E8FD6' }}>
                          <Zap className="h-3 w-3" /> Most popular
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-bold" style={{ color: '#1A2B4A' }}>{plan.name}</p>
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                              {plan.agents}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {plan.features.map(f => (
                              <span key={f} className="flex items-center gap-1 text-xs" style={{ color: '#7A8499' }}>
                                <Check className="h-3 w-3" style={{ color: '#1F8A5B' }} /> {f}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xl font-bold" style={{ color: '#1A2B4A' }}>${plan.price}</p>
                          <p className="text-xs" style={{ color: '#9AA3B2' }}>/month</p>
                        </div>
                      </div>
                      {active && (
                        <div className="absolute top-4 right-4 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#5E8FD6' }}>
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {error && <p className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

              <button
                onClick={handleCheckout}
                disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ background: '#0E1F3D' }}
              >
                {loading ? 'Redirecting to Stripe…' : `Pay $${PLANS.find(p => p.id === selectedPlan)?.price}/mo with Stripe →`}
              </button>

              <p className="text-center text-xs mt-4" style={{ color: '#9AA3B2' }}>
                Secured by Stripe. We never store your card details.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
