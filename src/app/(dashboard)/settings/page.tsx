'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Plus, Trash2, Check, Download, MessageCircle, ExternalLink, KeyRound } from 'lucide-react'
import { AGENTS } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import { DescriptionTemplate, DEFAULT_TEMPLATES, STORAGE_KEY, loadTemplates } from '@/lib/templates'
import { EXPORTS, EXPORT_LABELS, type ExportKind } from '@/lib/export-columns'

const COMMISSION_RATE = 2.5
const H   = '#1A2B4A'
const SUB = '#7A8499'

function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function ProfilePage() {
  // The real signed-in identity — this page used to hardcode agent 'a1'
  // (Lara Khoury) no matter who was logged in.
  const { session } = useSession()
  const manager = isManager(session?.role)
  const myAgentId = session?.agentCode ?? null

  const displayName = session?.fullName ?? 'Loading…'
  const roleLabel = manager ? 'Manager · StateGen' : 'Agent · StateGen'
  const agentColor = AGENTS.find(a => a.id === myAgentId)?.color ?? '#2E5288'

  const [templates, setTemplates] = useState<DescriptionTemplate[]>(DEFAULT_TEMPLATES)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newBody, setNewBody] = useState('')

  // Change password (Supabase updates the logged-in user's password — no email).
  const supabase = createClient()
  const [pw, setPw] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function changePassword() {
    setPwMsg(null)
    if (pw.length < 8) { setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return }
    if (pw !== pwConfirm) { setPwMsg({ ok: false, text: 'Passwords do not match.' }); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwSaving(false)
    if (error) { setPwMsg({ ok: false, text: error.message }); return }
    setPw(''); setPwConfirm('')
    setPwMsg({ ok: true, text: 'Password updated.' })
  }

  useEffect(() => { setTemplates(loadTemplates()) }, [])

  function saveTemplates(next: DescriptionTemplate[]) {
    setTemplates(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    // Mirror the active template to the server so description generation off the
    // browser (the WhatsApp bot) can use it. Fire-and-forget; localStorage stays
    // the source of truth for the editor itself.
    const active = next.find(t => t.active)?.body ?? null
    fetch('/api/company/template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: active }),
    }).catch(() => { /* offline / not signed in — non-fatal */ })
  }

  function toggleActive(id: string) {
    saveTemplates(templates.map(t => ({ ...t, active: t.id === id ? !t.active : false })))
  }

  function deleteTemplate(id: string) {
    saveTemplates(templates.filter(t => t.id !== id))
  }

  function startEdit(t: DescriptionTemplate) {
    setEditingId(t.id)
    setNewName(t.name)
    setNewBody(t.body)
  }

  function saveEdit(id: string) {
    saveTemplates(templates.map(t => t.id === id ? { ...t, name: newName, body: newBody } : t))
    setEditingId(null)
  }

  function addTemplate() {
    const t: DescriptionTemplate = { id: `t${Date.now()}`, name: 'New Template', body: '', active: false }
    saveTemplates([...templates, t])
    startEdit(t)
  }


  // ── WhatsApp connection ──
  type WaStatus = { connected: boolean; number: string | null; enabled: boolean; optInAt: string | null; reminderHour?: number }
  type WaConnect = { code: string; link: string; message: string; expiresInMinutes: number }
  const [wa, setWa] = useState<WaStatus | null>(null)
  const [waConnect, setWaConnect] = useState<WaConnect | null>(null)
  const [waBusy, setWaBusy] = useState(false)

  useEffect(() => {
    fetch('/api/me/whatsapp').then(r => r.ok ? r.json() : null).then(setWa).catch(() => {})
  }, [])

  // While a connect code is outstanding, poll until the agent's text lands.
  useEffect(() => {
    if (!waConnect) return
    const id = setInterval(async () => {
      const s = await fetch('/api/me/whatsapp').then(r => r.ok ? r.json() : null).catch(() => null)
      if (s) { setWa(s); if (s.connected) setWaConnect(null) }
    }, 4000)
    return () => clearInterval(id)
  }, [waConnect])

  async function waStartConnect() {
    setWaBusy(true)
    try {
      const r = await fetch('/api/me/whatsapp', { method: 'POST' })
      if (r.ok) setWaConnect(await r.json())
    } finally { setWaBusy(false) }
  }
  async function waToggle(enabled: boolean) {
    const r = await fetch('/api/me/whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    if (r.ok) setWa(w => w ? { ...w, enabled } : w)
  }
  async function waSetHour(reminderHour: number) {
    setWa(w => w ? { ...w, reminderHour } : w)   // optimistic
    await fetch('/api/me/whatsapp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reminderHour }) })
  }
  async function waDisconnect() {
    const r = await fetch('/api/me/whatsapp', { method: 'DELETE' })
    if (r.ok) { setWa({ connected: false, number: null, enabled: true, optInAt: null }); setWaConnect(null) }
  }

  // ── CSV export (managers only) ──
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [exportError, setExportError] = useState('')

  async function exportCsv(kind: ExportKind) {
    setExporting(kind)
    setExportError('')
    try {
      const res = await fetch(`/api/export?kind=${kind}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setExportError(body.error || 'Export failed. Please try again.')
        return
      }
      // Turn the response into a file download. The filename comes from the
      // server's Content-Disposition, so the date is authoritative.
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const named = disposition.match(/filename="(.+?)"/)?.[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named || `stategen-${kind}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Export failed. Please try again.')
    } finally {
      setExporting(null)
    }
  }


  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: agentColor }}>
          {initialsOf(displayName)}
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>{displayName}</h1>
          <p className="text-sm mt-0.5" style={{ color: SUB }}>{roleLabel}</p>
        </div>
      </div>

      {/* Change password */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div className="px-5 py-4 flex items-center gap-2.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <KeyRound className="h-5 w-5" style={{ color: '#2E5288' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: H }}>Change password</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Set a new password for signing in.</p>
          </div>
        </div>
        <div className="p-5 space-y-3 max-w-sm">
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password (min. 8 characters)"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ border: '1.5px solid #D7DCE5', color: '#14223F' }}
          />
          <input
            type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="Confirm new password"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ border: '1.5px solid #D7DCE5', color: '#14223F' }}
          />
          {pwMsg && (
            <p className="text-xs px-3 py-2 rounded-lg" style={pwMsg.ok ? { background: '#E3F4EA', color: '#1F7A4D' } : { background: '#FBE7E7', color: '#A23434' }}>{pwMsg.text}</p>
          )}
          <button
            onClick={changePassword} disabled={pwSaving || !pw}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: '#0E1F3D' }}
          >
            {pwSaving ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </div>

      {/* Commission rate strip */}
      <div className="rounded-2xl p-5 bg-white flex items-center justify-between" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div>
          <p className="text-sm font-bold" style={{ color: H }}>Commission Rate</p>
          <p className="text-xs mt-0.5" style={{ color: SUB }}>Applied to all closed deals</p>
        </div>
        <div className="text-2xl font-bold px-5 py-2 rounded-xl" style={{ background: '#EAF0FA', color: '#2E5288' }}>
          {COMMISSION_RATE}%
        </div>
      </div>

      {/* Export company data — managers only */}
      {manager && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <p className="text-sm font-bold" style={{ color: H }}>Export company data</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Download the whole agency&apos;s records as a CSV (opens in Excel or Sheets)</p>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {EXPORTS.map(kind => (
              <button
                key={kind}
                onClick={() => exportCsv(kind)}
                disabled={exporting !== null}
                className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: H }}
              >
                <Download className="h-4 w-4" style={{ color: '#2E5288' }} />
                {exporting === kind ? 'Preparing…' : EXPORT_LABELS[kind]}
              </button>
            ))}
          </div>
          {exportError && (
            <p className="px-5 pb-4 text-xs" style={{ color: '#A23434' }}>{exportError}</p>
          )}
        </div>
      )}

      {/* WhatsApp Assistant */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <div className="flex items-center gap-2.5">
            <MessageCircle className="h-5 w-5" style={{ color: '#25D366' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: H }}>WhatsApp Assistant</p>
              <p className="text-xs mt-0.5" style={{ color: SUB }}>Chat with StateGen from your own WhatsApp number</p>
            </div>
          </div>
          {wa && (
            <span
              className="px-2.5 py-1 rounded-full text-xs font-bold"
              style={
                wa.connected && wa.enabled ? { background: '#E4F7EC', color: '#1B8A4B' }
                : wa.connected ? { background: '#FBEFD6', color: '#9A6516' }
                : { background: '#F0F2F5', color: '#6A7488' }
              }
            >
              {wa.connected ? (wa.enabled ? 'Connected' : 'Paused') : 'Not connected'}
            </span>
          )}
        </div>

        <div className="p-5">
          {wa === null ? (
            <p className="text-xs" style={{ color: SUB }}>Loading…</p>
          ) : wa.connected ? (
            // ── Connected ──
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: H }}>{wa.number}</p>
                {wa.optInAt && (
                  <p className="text-xs mt-0.5" style={{ color: SUB }}>Connected since {new Date(wa.optInAt).toLocaleDateString()}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => waToggle(!wa.enabled)}
                  className="px-3 py-2 rounded-xl text-xs font-bold"
                  style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: H }}
                >
                  {wa.enabled ? 'Pause assistant' : 'Resume assistant'}
                </button>
                <button
                  onClick={waDisconnect}
                  className="px-3 py-2 rounded-xl text-xs font-bold"
                  style={{ border: '1.5px solid #F3D7D7', background: '#FDF5F5', color: '#A23434' }}
                >
                  Disconnect
                </button>
              </div>

              {/* Daily reminder time — the hour the agent gets their WhatsApp digest */}
              <div className="pt-3" style={{ borderTop: '1px solid #EEF0F4' }}>
                <label className="text-xs font-bold" style={{ color: H }}>Daily reminder time</label>
                <p className="text-xs mt-0.5 mb-2" style={{ color: SUB }}>
                  When you get your morning agenda &amp; follow-up nudge (Beirut time).
                </p>
                <select
                  value={wa.reminderHour ?? 9}
                  onChange={e => waSetHour(Number(e.target.value))}
                  className="rounded-xl px-3 py-2 text-sm font-semibold"
                  style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: H }}
                >
                  {Array.from({ length: 24 }, (_, h) => {
                    const label = new Date(2020, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
                    return <option key={h} value={h}>{label}</option>
                  })}
                </select>
              </div>
            </div>
          ) : waConnect ? (
            // ── Connecting: show the deep link + code, poll for the inbound ──
            <div className="space-y-3">
              <p className="text-sm" style={{ color: H }}>
                Tap below to open WhatsApp with the message ready, then hit <span className="font-bold">send</span>.
              </p>
              <a
                href={waConnect.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white"
                style={{ background: '#25D366' }}
              >
                <MessageCircle className="h-4 w-4" /> Open WhatsApp to connect <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <div className="rounded-xl px-4 py-3 text-center" style={{ background: '#F7F8FB', border: '1px solid #EEF0F4' }}>
                <p className="text-xs" style={{ color: SUB }}>Or message the bot with this code:</p>
                <p className="text-lg font-bold tracking-widest mt-1" style={{ color: H }}>{waConnect.code}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: SUB }}>
                  <span className="inline-block h-2 w-2 rounded-full mr-1.5 animate-pulse" style={{ background: '#25D366' }} />
                  Waiting for your message… (code expires in {waConnect.expiresInMinutes} min)
                </p>
                <button onClick={() => setWaConnect(null)} className="text-xs font-semibold" style={{ color: SUB }}>Cancel</button>
              </div>
            </div>
          ) : (
            // ── Not connected ──
            <div className="space-y-3">
              <p className="text-sm" style={{ color: SUB }}>
                Link your WhatsApp number to add listings and clients, move deals, get descriptions and more — right from a chat.
              </p>
              <button
                onClick={waStartConnect}
                disabled={waBusy}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: '#25D366' }}
              >
                <MessageCircle className="h-4 w-4" /> {waBusy ? 'Preparing…' : 'Connect WhatsApp'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description Templates */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: H }}>AI Description Templates</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Set the active template to guide AI descriptions in new listings</p>
          </div>
          <button
            onClick={addTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
            style={{ background: '#0E1F3D' }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <div className="divide-y" style={{ borderColor: '#EEF0F4' }}>
          {templates.length === 0 && (
            <p className="px-5 py-6 text-xs text-center" style={{ color: '#9AA3B2' }}>No templates yet. Add one to guide AI descriptions.</p>
          )}
          {templates.map(t => (
            <div key={t.id} className="p-4">
              {editingId === t.id ? (
                <div className="space-y-2">
                  <input
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none font-semibold"
                    style={{ border: '1.5px solid #5E8FD6', background: '#F7F8FB', color: '#14223F' }}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Template name"
                  />
                  {/* Roomy + resizable: a structured template runs ~20 lines,
                      which was unusable in the old 3-row fixed box. */}
                  <textarea
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none font-mono"
                    style={{ border: '1.5px solid #5E8FD6', background: '#F7F8FB', color: '#14223F', resize: 'vertical' }}
                    rows={10}
                    value={newBody}
                    onChange={e => setNewBody(e.target.value)}
                    placeholder={'Either a style note ("elegant, emphasise exclusivity")\nor a full layout with [placeholders] — e.g.\n\nThis [Adjective] [Property Type] in [Location]!\n[Property Type] Features:\n[X] Bathroom(s)\nPrice: $ [AMOUNT]'}
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>Cancel</button>
                    <button onClick={() => saveEdit(t.id)} disabled={!newName} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: '#0E1F3D' }}>Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  {/* Active toggle */}
                  <button
                    onClick={() => toggleActive(t.id)}
                    title={t.active ? 'Active — click to deactivate' : 'Click to set as active'}
                    className="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors mt-0.5"
                    style={t.active
                      ? { background: '#1F7A4D', borderColor: '#1F7A4D' }
                      : { background: 'transparent', borderColor: '#C4CAD6' }
                    }
                  >
                    {t.active && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold" style={{ color: H }}>{t.name}</p>
                      {t.active && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>Active</span>
                      )}
                    </div>
                    {/* pre-wrap + clamp so a long structured template previews
                        with its line breaks without swamping the list */}
                    <p
                      className="text-xs mt-1 leading-relaxed line-clamp-4"
                      style={{ color: SUB, whiteSpace: 'pre-wrap' }}
                    >
                      {t.body || <span className="italic" style={{ color: '#C4CAD6' }}>No template yet</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Edit">
                      <ChevronRight className="h-3.5 w-3.5" style={{ color: SUB }} />
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" style={{ color: '#A23434' }} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
