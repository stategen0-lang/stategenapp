'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

const PROPERTY_TYPES = ['Appartement', 'Villa', 'Office', 'Shop', 'Land', 'Building', 'Showroom', 'Restaurant']

export default function MicrositeContactForm({ slug, accent, onAccent, agency }: { slug: string; accent: string; onAccent: string; agency: string }) {
  const [f, setF] = useState({ name: '', phone: '', clientType: 'buyer', propertyType: '', location: '', budget: '', message: '', company: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!f.name.trim() || !f.phone.trim()) { setError('Please add your name and phone.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/microsite/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, ...f }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setError(j.error || 'Something went wrong. Please try again.'); return }
      setDone(true)
    } catch { setError('Network error. Please try again.') }
    finally { setBusy(false) }
  }

  const inp = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none'
  const inpStyle = { border: '1.5px solid #D7DCE5', color: '#14223F', background: '#fff' } as const

  if (done) return (
    <div className="text-center py-4">
      <CheckCircle2 className="h-8 w-8 mx-auto mb-2" style={{ color: '#1F7A4D' }} />
      <p className="text-sm font-bold" style={{ color: '#14223F' }}>Thanks, {f.name.split(' ')[0]}!</p>
      <p className="text-xs mt-1" style={{ color: '#6A7488' }}>{agency} has your request and an agent will be in touch.</p>
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Honeypot — bots fill it, humans never see it. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" value={f.company} onChange={set('company')} style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }} aria-hidden />

      <div className="grid grid-cols-2 gap-3">
        <input className={`${inp} col-span-2`} style={inpStyle} placeholder="Your name *" value={f.name} onChange={set('name')} />
        <input className={inp} style={inpStyle} placeholder="Phone *" value={f.phone} onChange={set('phone')} />
        <select className={inp} style={inpStyle} value={f.clientType} onChange={set('clientType')}>
          <option value="buyer">Buying</option>
          <option value="renter">Renting</option>
        </select>
        <select className={inp} style={inpStyle} value={f.propertyType} onChange={set('propertyType')}>
          <option value="">Any type</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={inp} style={inpStyle} placeholder="Area (e.g. Achrafieh)" value={f.location} onChange={set('location')} />
        <input className={`${inp} col-span-2`} style={inpStyle} type="number" inputMode="numeric" placeholder="Budget (USD)" value={f.budget} onChange={set('budget')} />
      </div>
      <textarea className={inp} style={{ ...inpStyle, resize: 'none' }} rows={2} placeholder="Anything else? (optional)" value={f.message} onChange={set('message')} />

      {error && <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#FBE7E7', color: '#A23434' }}>{error}</p>}

      <button type="submit" disabled={busy} className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: accent, color: onAccent }}>
        {busy ? 'Sending…' : 'Send request'}
      </button>
      <p className="text-[11px] text-center" style={{ color: '#9AA3B2' }}>Your details go straight to {agency} — no spam.</p>
    </form>
  )
}
