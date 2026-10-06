'use client'

import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { renewalInfo, seatState, TONE_STYLE } from '@/lib/plan-card'

// "Your plan" on Settings, for managers: plan, price, users used against the
// limit, and the paid-through date. Read-only — StateGen sets all of it.
// Fetches its own data; if the call fails the card simply isn't shown.

const H = '#14223F'
const SUB = '#7A8499'
const CONTACT = 'stategen0@gmail.com'

interface PlanData {
  company: string | null
  planName: string | null
  price: number | null
  userLimit: number | null
  usersLabel: string | null
  usersUsed: number
  status: string
  accessUntil: string | null
}

export default function PlanCard() {
  const [d, setD] = useState<PlanData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading')

  useEffect(() => {
    let live = true
    fetch('/api/company/plan')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(j => { if (live) { setD(j); setState('ready') } })
      .catch(() => { if (live) setState('hidden') })
    return () => { live = false }
  }, [])

  if (state === 'hidden') return null

  const card = 'rounded-2xl bg-white overflow-hidden'
  const cardStyle = { boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' } as const

  if (state === 'loading' || !d) {
    return (
      <div className={card} style={cardStyle}>
        <div className="px-5 py-4 flex items-center gap-2.5">
          <CreditCard className="h-5 w-5" style={{ color: '#2E5288' }} />
          <p className="text-sm font-bold" style={{ color: H }}>Your plan</p>
        </div>
        <div className="px-5 pb-5"><div className="h-16 rounded-xl animate-pulse" style={{ background: '#F4F6FA' }} /></div>
      </div>
    )
  }

  const renewal = renewalInfo(d.status, d.accessUntil)
  const seats = seatState(d.usersUsed, d.userLimit)
  const hasPlan = d.planName != null
  // "Active" with no end date is still good news — green, not the grey of a missing date.
  const statusPill = TONE_STYLE[d.status === 'active' && renewal.tone === 'muted' ? 'ok' : renewal.tone]
  const statusLabel =
    d.status === 'active' ? 'Active' : d.status === 'pending' ? 'Pending' : d.status === 'expired' ? 'Ended' : d.status === 'suspended' ? 'Suspended' : 'Inactive'
  const mailto = `mailto:${CONTACT}?subject=${encodeURIComponent(`StateGen plan${d.company ? ' – ' + d.company : ''}`)}`

  return (
    <div className={card} style={cardStyle}>
      <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid #EEF0F4' }}>
        <div className="flex items-center gap-2.5">
          <CreditCard className="h-5 w-5" style={{ color: '#2E5288' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: H }}>Your plan</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>What you&apos;re on and how much of it you&apos;re using.</p>
          </div>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: statusPill.bg, color: statusPill.color }}>{statusLabel}</span>
      </div>

      <div className="p-5 space-y-5">
        {/* Plan + price */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xl font-extrabold" style={{ color: H, letterSpacing: '-0.3px' }}>{hasPlan ? d.planName : 'No plan set yet'}</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>
              {hasPlan ? `${d.usersLabel ?? ''}${d.usersLabel ? ' · ' : ''}Full access to every feature` : 'Contact StateGen to choose one.'}
            </p>
          </div>
          {hasPlan && (
            <p className="text-sm font-bold tabular-nums" style={{ color: H }}>
              {d.price != null ? <>${d.price}<span className="font-medium" style={{ color: SUB }}> / month</span></> : 'Custom pricing'}
            </p>
          )}
        </div>

        {/* Users used against the limit */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-bold tracking-wide" style={{ color: SUB }}>USERS</p>
            <p className="text-sm font-semibold tabular-nums" style={{ color: H }}>{hasPlan ? seats.text : `${d.usersUsed} user${d.usersUsed === 1 ? '' : 's'}`}</p>
          </div>
          {hasPlan && seats.pct != null && (
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#EEF0F4' }} role="progressbar" aria-valuenow={seats.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Users used">
              <div className="h-full rounded-full" style={{ width: `${seats.pct}%`, background: seats.tone === 'bad' ? '#D94A4A' : seats.tone === 'warn' ? '#E8A93C' : '#5E8FD6' }} />
            </div>
          )}
          {hasPlan && seats.note && <p className="text-xs mt-1.5" style={{ color: TONE_STYLE[seats.tone].color }}>{seats.note}</p>}
          <p className="text-[11px] mt-1.5" style={{ color: SUB }}>Managers and approved agents each take one user.</p>
        </div>

        {/* Renewal */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-bold tracking-wide" style={{ color: SUB }}>RENEWAL</p>
          <p className="text-sm font-semibold" style={{ color: renewal.tone === 'muted' ? SUB : TONE_STYLE[renewal.tone].color }}>{renewal.text}</p>
        </div>

        {/* Contact */}
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-4 py-3" style={{ background: '#F7F8FB' }}>
          <p className="text-xs" style={{ color: SUB }}>Need more users, or a 6-month or yearly deal?</p>
          <a href={mailto} className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: '#EAF0FA', color: '#2E5288' }}>Contact StateGen</a>
        </div>
      </div>
    </div>
  )
}
