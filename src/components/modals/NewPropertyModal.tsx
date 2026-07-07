'use client'

import { useState, useRef } from 'react'
import { Sparkles, Loader2, ImagePlus } from 'lucide-react'
import { Property, PropertyType, Transaction, PropertyStatus, AdvancedPayment, AgentId, CURRENT_AGENT_ID } from '@/lib/data'

const PROPERTY_TYPES: PropertyType[] = ['Appartement', 'Shop', 'Office', 'Building', 'Villa', 'Land', 'Showroom', 'Restaurant']

interface Props {
  onClose: () => void
  onSaved: (p: Property) => void
}

let _nextId = 100

export default function NewPropertyModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    title: '', type: 'Appartement' as PropertyType, transaction: 'For Sale' as Transaction,
    price: '', rent: '', district: '', city: '', size: '', beds: '', baths: '',
    garden: false, balcony: false, view: '', status: 'Available' as PropertyStatus,
    advancedPayment: '' as AdvancedPayment | '',
    notes: '',
  })
  const [photos, setPhotos]     = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError]     = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function set(k: string, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleAiDescription() {
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/ai/property-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
      })
      const data = await res.json()
      if (data.description) {
        set('notes', data.description)
      } else {
        setAiError('Could not generate description. Try again.')
      }
    } catch {
      setAiError('Network error. Try again.')
    } finally {
      setAiLoading(false)
    }
  }

  function handlePhotoFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = e => {
        setPhotos(prev => [...prev, e.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  function handleSave() {
    if (!form.title || !form.district || !form.city) return
    const p: Property = {
      id: ++_nextId,
      title: form.title,
      type: form.type,
      transaction: form.transaction,
      price: parseInt(form.price) || 0,
      rent: parseInt(form.rent) || 0,
      district: form.district,
      city: form.city,
      size: parseInt(form.size) || 0,
      beds: parseInt(form.beds) || 0,
      baths: parseInt(form.baths) || 0,
      garden: form.garden,
      balcony: form.balcony,
      view: form.view,
      status: form.status,
      agentId: CURRENT_AGENT_ID as AgentId,
      notes: form.notes || undefined,
      advancedPayment: (form.transaction === 'For Rent' && form.advancedPayment) ? form.advancedPayment as AdvancedPayment : undefined,
      photos: photos.length > 0 ? photos : undefined,
    }
    onSaved(p)
  }

  const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none'
  const inpStyle = { border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: '#14223F' }
  const label = 'text-xs font-semibold mb-1 block'
  const labelStyle = { color: '#6A7488' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
      style={{ background: 'rgba(14,31,61,0.45)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full md:max-w-md md:rounded-2xl rounded-t-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <p className="text-base font-bold" style={{ color: '#14223F' }}>New Listing</p>
          <button onClick={onClose} style={{ color: '#9AA3B2' }} className="hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto max-h-[72vh]">
          {/* Title */}
          <div>
            <label className={label} style={labelStyle}>Title *</label>
            <input className={inp} style={inpStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Raouché Appartement" />
          </div>

          {/* Type + Transaction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} style={labelStyle}>Type</label>
              <select className={inp} style={inpStyle} value={form.type} onChange={e => set('type', e.target.value)}>
                {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={label} style={labelStyle}>Transaction</label>
              <select className={inp} style={inpStyle} value={form.transaction} onChange={e => set('transaction', e.target.value)}>
                <option>For Sale</option>
                <option>For Rent</option>
              </select>
            </div>
          </div>

          {/* Price + Status */}
          <div className="grid grid-cols-2 gap-3">
            {form.transaction === 'For Sale' ? (
              <div>
                <label className={label} style={labelStyle}>Price (USD)</label>
                <input className={inp} style={inpStyle} type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="480000" />
              </div>
            ) : (
              <div>
                <label className={label} style={labelStyle}>Rent/mo (USD)</label>
                <input className={inp} style={inpStyle} type="number" value={form.rent} onChange={e => set('rent', e.target.value)} placeholder="1500" />
              </div>
            )}
            <div>
              <label className={label} style={labelStyle}>Status</label>
              <select className={inp} style={inpStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {['Available','Pending','Reserved','Sold'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Advanced payment — rental only */}
          {form.transaction === 'For Rent' && (
            <div>
              <label className={label} style={labelStyle}>Advanced payment <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(optional)</span></label>
              <select className={inp} style={inpStyle} value={form.advancedPayment} onChange={e => set('advancedPayment', e.target.value)}>
                <option value="">None required</option>
                <option>3 months</option>
                <option>6 months</option>
                <option>1 year</option>
              </select>
            </div>
          )}

          {/* District + City */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} style={labelStyle}>District *</label>
              <input className={inp} style={inpStyle} value={form.district} onChange={e => set('district', e.target.value)} placeholder="Raouché" />
            </div>
            <div>
              <label className={label} style={labelStyle}>City *</label>
              <input className={inp} style={inpStyle} value={form.city} onChange={e => set('city', e.target.value)} placeholder="Beirut" />
            </div>
          </div>

          {/* Size + Beds + Baths */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label} style={labelStyle}>Size (m²)</label>
              <input className={inp} style={inpStyle} type="number" value={form.size} onChange={e => set('size', e.target.value)} placeholder="145" />
            </div>
            <div>
              <label className={label} style={labelStyle}>Beds</label>
              <input className={inp} style={inpStyle} type="number" value={form.beds} onChange={e => set('beds', e.target.value)} placeholder="3" />
            </div>
            <div>
              <label className={label} style={labelStyle}>Baths</label>
              <input className={inp} style={inpStyle} type="number" value={form.baths} onChange={e => set('baths', e.target.value)} placeholder="2" />
            </div>
          </div>

          {/* View */}
          <div>
            <label className={label} style={labelStyle}>View</label>
            <input className={inp} style={inpStyle} value={form.view} onChange={e => set('view', e.target.value)} placeholder="Sea, Mountain, City…" />
          </div>

          {/* Features */}
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.garden} onChange={e => set('garden', e.target.checked)} className="rounded" />
              Garden
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.balcony} onChange={e => set('balcony', e.target.checked)} className="rounded" />
              Balcony
            </label>
          </div>

          {/* Notes + AI button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={label} style={{ ...labelStyle, marginBottom: 0 }}>Description / Notes <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(optional)</span></label>
              <button
                type="button"
                onClick={handleAiDescription}
                disabled={aiLoading}
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-60"
                style={{ background: '#EAF0FA', color: '#2E5288' }}
              >
                {aiLoading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-3 w-3" /> AI Description</>
                }
              </button>
            </div>
            {aiError && <p className="text-xs mb-1" style={{ color: '#A23434' }}>{aiError}</p>}
            <textarea
              className={inp}
              style={{ ...inpStyle, resize: 'none' }}
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Agent notes or property description…"
            />
          </div>

          {/* Photos */}
          <div>
            <label className={label} style={labelStyle}>Photos</label>
            <div className="flex flex-wrap gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden" style={{ width: 72, height: 52 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center text-xs leading-none"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                  >✕</button>
                </div>
              ))}
              {/* Add photos button — always last */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center rounded-xl gap-1 text-xs font-medium transition-colors hover:bg-blue-50"
                style={{ width: 72, height: 52, border: '1.5px dashed #C4CAD6', color: '#7A8499' }}
              >
                <ImagePlus className="h-4 w-4" />
                Add
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => handlePhotoFiles(e.target.files)}
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid #EEF0F4' }}>
          <button onClick={onClose} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.title || !form.district || !form.city}
            className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: '#0E1F3D' }}
          >
            Save listing
          </button>
        </div>
      </div>
    </div>
  )
}
