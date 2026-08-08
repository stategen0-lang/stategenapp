'use client'

import { useState, useEffect } from 'react'
import { Building2, Lock, CheckCircle2, XCircle, Clock } from 'lucide-react'

const ADMIN_PIN = 'sg2026'

interface Company {
  id: number
  Name: string
  domain: string
  Plan: string
  'is active': boolean
  stripe_status: string
  created_at: string
}

export default function AdminPage() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)

  function handlePin(e: React.FormEvent) {
    e.preventDefault()
    if (pin === ADMIN_PIN) {
      setUnlocked(true)
      setPinError(false)
    } else {
      setPinError(true)
    }
  }

  useEffect(() => {
    if (!unlocked) return
    setLoading(true)
    fetch('/api/admin/companies')
      .then(r => r.json())
      .then(data => setCompanies(data.companies ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [unlocked])

  async function toggleActive(company: Company) {
    setToggling(company.id)
    const newActive = !company['is active']
    try {
      await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, active: newActive }),
      })
      setCompanies(prev => prev.map(c => c.id === company.id ? { ...c, 'is active': newActive, stripe_status: newActive ? 'active' : 'pending_payment' } : c))
    } catch {}
    setToggling(null)
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0E1F3D', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div className="w-full max-w-xs">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: '#1a3258' }}>
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white text-center mb-1">Admin Panel</h1>
          <p className="text-sm text-center mb-6" style={{ color: '#9DB2CC' }}>StateGen · Internal</p>
          <form onSubmit={handlePin} className="space-y-3">
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none text-center tracking-widest"
              style={{ background: '#1a3258', color: '#fff', border: pinError ? '1.5px solid #e05c5c' : '1.5px solid #2a4570', fontFamily: 'inherit' }}
            />
            {pinError && <p className="text-xs text-center" style={{ color: '#e05c5c' }}>Incorrect PIN</p>}
            <button type="submit" className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#5E8FD6' }}>
              Unlock →
            </button>
          </form>
        </div>
      </div>
    )
  }

  const total = companies.length
  const active = companies.filter(c => c['is active']).length
  const pending = total - active

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: '#faf9f5', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: '#1A2B4A' }}>StateGen Admin</h1>
          <p className="text-sm mt-1" style={{ color: '#7A8499' }}>Company activation panel</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total', value: total, icon: Building2, color: '#5E8FD6', bg: '#EAF0FA' },
            { label: 'Active', value: active, icon: CheckCircle2, color: '#1F7A4D', bg: '#E3F4EA' },
            { label: 'Pending', value: pending, icon: Clock, color: '#9A6516', bg: '#FBEFD6' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold" style={{ color: '#1A2B4A' }}>{value}</p>
                  <p className="text-xs" style={{ color: '#9AA3B2' }}>{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Companies table */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#EEF0F4' }}>
            <h2 className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>All Companies</h2>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>Loading…</div>
          ) : companies.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>No companies yet.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
              {companies.map(company => {
                const isActive = company['is active']
                return (
                  <div key={company.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
                        <Building2 className="h-4 w-4" style={{ color: '#2E5288' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#1A2B4A' }}>{company.Name}</p>
                        <p className="text-xs truncate" style={{ color: '#9AA3B2' }}>{company.domain} · {company.Plan}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5">
                        {isActive
                          ? <CheckCircle2 className="h-4 w-4" style={{ color: '#1F7A4D' }} />
                          : <XCircle className="h-4 w-4" style={{ color: '#9AA3B2' }} />
                        }
                        <span className="text-xs font-medium" style={{ color: isActive ? '#1F7A4D' : '#9AA3B2' }}>
                          {isActive ? 'Active' : 'Pending'}
                        </span>
                      </div>
                      <p className="text-xs hidden sm:block" style={{ color: '#C0C6D4' }}>
                        {new Date(company.created_at).toLocaleDateString()}
                      </p>
                      <button
                        onClick={() => toggleActive(company)}
                        disabled={toggling === company.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
                        style={isActive
                          ? { background: '#FBE7E7', color: '#A23434' }
                          : { background: '#E3F4EA', color: '#1F7A4D' }
                        }
                      >
                        {toggling === company.id ? '…' : isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
