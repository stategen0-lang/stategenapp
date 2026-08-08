'use client'

import { useState, useEffect, useRef } from 'react'
import { Building2, Lock, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, User, Calendar } from 'lucide-react'

const ADMIN_PIN = 'sg2026'

const QUICK = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
]

function addDays(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Agent {
  id: string
  Full_name: string
  role: string
  agent_code: string | null
  approved: boolean
  created_at: string
}

interface Company {
  id: number
  Name: string
  domain: string
  Plan: string
  'is active': boolean
  access_status: string
  access_until: string | null
  created_at: string
}

export default function AdminPage() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)

  // Activation picker state
  const [activating, setActivating] = useState<number | null>(null)   // company id being activated
  const [untilDate, setUntilDate] = useState('')
  const [saving, setSaving] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Per-company agent list
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [agentsMap, setAgentsMap] = useState<Record<number, Agent[]>>({})
  const [agentsLoading, setAgentsLoading] = useState<number | null>(null)
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null)

  // Close picker on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setActivating(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handlePin(e: React.FormEvent) {
    e.preventDefault()
    if (pin === ADMIN_PIN) { setUnlocked(true); setPinError(false) }
    else setPinError(true)
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

  function openActivatePicker(company: Company) {
    // Pre-fill: extend from current access_until if still in future, otherwise from today
    const base = company.access_until && new Date(company.access_until) > new Date()
      ? new Date(company.access_until)
      : new Date()
    const def = new Date(base)
    def.setDate(def.getDate() + 30)
    setUntilDate(def.toISOString().slice(0, 10))
    setActivating(company.id)
  }

  async function confirmActivate(company: Company) {
    setSaving(true)
    try {
      await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, active: true, access_until: untilDate }),
      })
      setCompanies(prev => prev.map(c =>
        c.id === company.id
          ? { ...c, 'is active': true, access_status: 'active', access_until: untilDate }
          : c
      ))
      setActivating(null)
    } catch {}
    setSaving(false)
  }

  async function deactivate(company: Company) {
    try {
      await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, active: false }),
      })
      setCompanies(prev => prev.map(c =>
        c.id === company.id ? { ...c, 'is active': false, access_status: 'pending' } : c
      ))
    } catch {}
  }

  async function expandCompany(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (agentsMap[id]) return
    setAgentsLoading(id)
    try {
      const r = await fetch(`/api/admin/agents?companyId=${id}`)
      const data = await r.json()
      setAgentsMap(prev => ({ ...prev, [id]: data.agents ?? [] }))
    } catch {}
    setAgentsLoading(null)
  }

  async function toggleAgent(companyId: number, agent: Agent) {
    setTogglingAgent(agent.id)
    const newApproved = !agent.approved
    try {
      await fetch('/api/admin/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, approved: newApproved }),
      })
      setAgentsMap(prev => ({
        ...prev,
        [companyId]: (prev[companyId] ?? []).map(a =>
          a.id === agent.id ? { ...a, approved: newApproved } : a
        ),
      }))
    } catch {}
    setTogglingAgent(null)
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
              autoFocus
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
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: '#1A2B4A' }}>StateGen Admin</h1>
          <p className="text-sm mt-1" style={{ color: '#7A8499' }}>Company & agent activation panel</p>
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

        {/* Companies list */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#EEF0F4' }}>
            <h2 className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>All Companies</h2>
            <p className="text-xs mt-0.5" style={{ color: '#9AA3B2' }}>Click ▶ to see agents · Click Activate to set expiry date</p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>Loading…</div>
          ) : companies.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: '#9AA3B2' }}>No companies yet.</div>
          ) : (
            <div>
              {companies.map(company => {
                const isActive = company['is active']
                const isExpanded = expandedId === company.id
                const agents = agentsMap[company.id]
                const isPickerOpen = activating === company.id

                return (
                  <div key={company.id} style={{ borderBottom: '1px solid #EEF0F4' }}>
                    {/* Company row */}
                    <div className="px-5 py-4 flex items-center gap-3">
                      <button
                        onClick={() => expandCompany(company.id)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg"
                        style={{ background: isExpanded ? '#EAF0FA' : 'transparent', color: '#5E8FD6' }}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
                        <Building2 className="h-4 w-4" style={{ color: '#2E5288' }} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#1A2B4A' }}>{company.Name}</p>
                        <p className="text-xs truncate" style={{ color: '#9AA3B2' }}>
                          {company.domain} · {company.Plan}
                          {company.access_until && (
                            <span style={{ color: isActive ? '#1F7A4D' : '#9A6516' }}>
                              {' '}· expires {fmtDate(company.access_until)}
                            </span>
                          )}
                        </p>
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

                        {isActive ? (
                          <div className="flex gap-2">
                            {/* Extend button */}
                            <button
                              onClick={() => openActivatePicker(company)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ background: '#EAF0FA', color: '#2E5288' }}
                            >
                              Extend
                            </button>
                            {/* Deactivate button */}
                            <button
                              onClick={() => deactivate(company)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ background: '#FBE7E7', color: '#A23434' }}
                            >
                              Deactivate
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => openActivatePicker(company)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: '#E3F4EA', color: '#1F7A4D' }}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Activation date picker */}
                    {isPickerOpen && (
                      <div ref={pickerRef} className="mx-5 mb-4 rounded-2xl p-4" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar className="h-4 w-4" style={{ color: '#2E5288' }} />
                          <p className="text-sm font-semibold" style={{ color: '#1A2B4A' }}>
                            {isActive ? 'Extend access until' : 'Activate until'}
                          </p>
                        </div>

                        {/* Quick options */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          {QUICK.map(q => (
                            <button
                              key={q.days}
                              onClick={() => setUntilDate(addDays(q.days))}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              style={untilDate === addDays(q.days)
                                ? { background: '#0E1F3D', color: '#fff' }
                                : { background: '#fff', color: '#1A2B4A', border: '1px solid #D8E2F0' }
                              }
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>

                        {/* Custom date */}
                        <div className="flex items-center gap-3">
                          <input
                            type="date"
                            value={untilDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={e => setUntilDate(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                            style={{ border: '1.5px solid #D8E2F0', color: '#1A2B4A', background: '#fff', fontFamily: 'inherit' }}
                          />
                          <button
                            onClick={() => confirmActivate(company)}
                            disabled={!untilDate || saving}
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: '#1F7A4D' }}
                          >
                            {saving ? '…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setActivating(null)}
                            className="px-3 py-2 rounded-xl text-sm font-semibold"
                            style={{ background: '#fff', color: '#9AA3B2', border: '1px solid #D8E2F0' }}
                          >
                            Cancel
                          </button>
                        </div>

                        {untilDate && (
                          <p className="text-xs mt-2" style={{ color: '#5E8FD6' }}>
                            Access active until {fmtDate(untilDate)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Agents panel */}
                    {isExpanded && (
                      <div className="px-5 pb-4" style={{ background: '#F7F8FB' }}>
                        <p className="text-xs font-semibold mb-3 pt-3" style={{ color: '#6A7488' }}>AGENTS</p>
                        {agentsLoading === company.id ? (
                          <p className="text-xs py-4 text-center" style={{ color: '#9AA3B2' }}>Loading agents…</p>
                        ) : !agents || agents.length === 0 ? (
                          <p className="text-xs py-4 text-center" style={{ color: '#9AA3B2' }}>No agents yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {agents.map(agent => (
                              <div key={agent.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F0F2F7' }}>
                                  <User className="h-3.5 w-3.5" style={{ color: '#6A7488' }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate" style={{ color: '#1A2B4A' }}>{agent.Full_name}</p>
                                  <p className="text-xs" style={{ color: '#9AA3B2' }}>
                                    {agent.role}{agent.agent_code ? ` · ${agent.agent_code}` : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-medium" style={{ color: agent.approved ? '#1F7A4D' : '#9A6516' }}>
                                    {agent.approved ? 'Open' : 'Pending'}
                                  </span>
                                  <button
                                    onClick={() => toggleAgent(company.id, agent)}
                                    disabled={togglingAgent === agent.id}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
                                    style={agent.approved
                                      ? { background: '#FBE7E7', color: '#A23434' }
                                      : { background: '#E3F4EA', color: '#1F7A4D' }
                                    }
                                  >
                                    {togglingAgent === agent.id ? '…' : agent.approved ? 'Close' : 'Open'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
