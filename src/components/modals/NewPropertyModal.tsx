'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Loader2, ImagePlus, ChevronDown, ChevronLeft, ChevronRight, FileText, X, MapPin, Video } from 'lucide-react'
import { Property, PropertyType, Transaction, PropertyStatus, AdvancedPayment, Furnishing, AgentId, CURRENT_AGENT_ID, PROPERTY_TYPES, propertyTypeLabel } from '@/lib/data'
import { useSession } from '@/hooks/use-session'
import { DescriptionTemplate, loadTemplates } from '@/lib/templates'
import { createClient as createSupabaseBrowser } from '@/lib/supabase/client'
import { VIDEO_BUCKET, MAX_VIDEO_BYTES } from '@/lib/upload'

const FURNISHINGS: Furnishing[] = ['Furnished', 'Semi-furnished', 'Unfurnished']


interface Props {
  onClose: () => void
  onSaved: (p: Property) => void
  initial?: Property
}

let _nextId = 100

export default function NewPropertyModal({ onClose, onSaved, initial }: Props) {
  const editing = !!initial
  const { session } = useSession()
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    type: (initial?.type ?? 'Appartement') as PropertyType,
    transaction: (initial?.transaction ?? 'For Sale') as Transaction,
    price: initial?.price ? String(initial.price) : '',
    rent: initial?.rent ? String(initial.rent) : '',
    district: initial?.district ?? '',
    city: initial?.city ?? '',
    size: initial?.size ? String(initial.size) : '',
    beds: initial?.beds ? String(initial.beds) : '',
    baths: initial?.baths ? String(initial.baths) : '',
    parkings: initial?.parkings ? String(initial.parkings) : '',
    buildingAge: initial?.buildingAge ? String(initial.buildingAge) : '',
    needsRenovation: initial?.needsRenovation ?? false,
    garden: initial?.garden ?? false,
    balcony: initial?.balcony ?? false,
    terrace: initial?.terrace ?? false,
    furnishing: (initial?.furnishing ?? '') as Furnishing | '',
    view: initial?.view ?? '',
    mapUrl: initial?.mapUrl ?? '',
    video: initial?.video ?? '',
    status: (initial?.status ?? 'Available') as PropertyStatus,
    advancedPayment: (initial?.advancedPayment ?? '') as AdvancedPayment | '',
    aiDescription: initial?.aiDescription ?? '',
    notes: initial?.notes ?? '',
    referredBy: initial?.referredBy ?? '',
    ownerName: initial?.ownerName ?? '',
    ownerContact: initial?.ownerContact ?? '',
  })
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  // Private document: path lives in the private bucket; we keep the display name.
  const [docPath, setDocPath] = useState<string>(initial?.documentPath ?? '')
  const [docName, setDocName] = useState<string>(initial?.documentName ?? '')
  const [docUploading, setDocUploading] = useState(false)
  const [docError, setDocError] = useState('')
  const docInputRef = useRef<HTMLInputElement>(null)
  // Video: uploaded straight to Storage (form.video holds the resulting URL).
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoError, setVideoError] = useState('')
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dupes, setDupes] = useState<{ id: number; title: string }[]>([])
  const [templates, setTemplates] = useState<DescriptionTemplate[]>(loadTemplates())
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('none')
  const [templateOpen, setTemplateOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loaded = loadTemplates()
    setTemplates(loaded)
    const active = loaded.find(t => t.active)
    if (active) setSelectedTemplateId(active.id)
  }, [])

  function set(k: string, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  async function handleAiDescription() {
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/ai/property-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          template: selectedTemplate?.body || undefined,
        }),
      })
      const data = await res.json()
      if (data.description) {
        set('aiDescription', data.description)
      } else {
        setAiError('Could not generate description. Try again.')
      }
    } catch {
      setAiError('Network error. Try again.')
    } finally {
      setAiLoading(false)
    }
  }

  // Photos are uploaded to Storage and stored as URLs. They used to be read as
  // base64 and crammed into the database row, which bloated every property and
  // did not scale past a couple of images.
  async function handlePhotoFiles(files: FileList | null) {
    if (!files || !files.length) return
    setPhotoError('')
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setPhotoError(data.error || `Could not upload ${file.name}.`)
          continue   // keep whatever else uploaded
        }
        const { url } = await res.json()
        setPhotos(prev => [...prev, url])
      }
    } finally {
      setUploading(false)
      // Allow re-selecting the same file after a removal.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Reorder photos. The first photo is the cover (shown on cards and the public
  // page), so agents need to promote the best shot without re-uploading.
  function movePhoto(from: number, to: number) {
    setPhotos(prev => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // Private document — goes to the private bucket via its own endpoint, which
  // returns a storage path (not a public URL).
  async function handleDocFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setDocError('')
    setDocUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload/document', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setDocError(data.error || 'Could not upload the document.'); return }
      setDocPath(data.path)
      setDocName(data.name)
    } catch {
      setDocError('Network error. Try again.')
    } finally {
      setDocUploading(false)
      if (docInputRef.current) docInputRef.current.value = ''
    }
  }

  // Video — uploaded straight from the phone to Storage via a signed URL, so a
  // large raw clip never hits the (4.5 MB) server request limit.
  async function handleVideoFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setVideoError('')
    if (!file.type.startsWith('video/')) { setVideoError('Please choose a video file.'); return }
    if (file.size > MAX_VIDEO_BYTES) {
      setVideoError(`Video is too large (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB). Trim it and try again.`)
      return
    }
    setVideoUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'mp4')
      // 1) Ask our server for a one-time signed upload URL.
      const res = await fetch('/api/upload/video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) { setVideoError(data.error || 'Could not start the upload.'); return }
      // 2) Send the file straight to Storage (bypasses the server body limit).
      const sb = createSupabaseBrowser()
      const { error } = await sb.storage.from(VIDEO_BUCKET).uploadToSignedUrl(data.path, data.token, file)
      if (error) { setVideoError('Upload failed. Please try again.'); return }
      set('video', data.url)
    } catch {
      setVideoError('Network error. Try again.')
    } finally {
      setVideoUploading(false)
      if (videoInputRef.current) videoInputRef.current.value = ''
    }
  }

  async function handleSave(skipDupeCheck = false) {
    // District (neighborhood) is optional — land plots and some areas have none.
    if (!form.title || !form.city) { setSaveError('Title and city are required.'); return }
    setSaveError('')

    // Warn about a likely-duplicate listing before creating a new one (never on
    // an edit). Overridable with "Save anyway".
    if (!editing && !skipDupeCheck) {
      setSaving(true)
      try {
        const r = await fetch('/api/properties/check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title, district: form.district, city: form.city, type: form.type,
            transaction: form.transaction, price: parseInt(form.price) || 0, rent: parseInt(form.rent) || 0,
          }),
        })
        if (r.ok) {
          const d = await r.json()
          if (Array.isArray(d.dupes) && d.dupes.length) { setDupes(d.dupes); setSaving(false); return }
        }
      } catch { /* if the check fails, don't block the save */ }
    }
    setDupes([])
    setSaving(true)
    // Own code when signed in; the server re-stamps this for agents anyway.
    const agentId = (initial?.agentId ?? session?.agentCode ?? CURRENT_AGENT_ID) as AgentId
    const payload = {
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
      parkings: parseInt(form.parkings) || undefined,
      buildingAge: parseInt(form.buildingAge) || undefined,
      needsRenovation: form.needsRenovation || undefined,
      garden: form.garden,
      balcony: form.balcony,
      terrace: form.terrace,
      furnishing: form.furnishing || undefined,
      view: form.view,
      mapUrl: form.mapUrl.trim() || undefined,
      video: form.video.trim() || undefined,
      status: form.status,
      agentId,
      aiDescription: form.aiDescription || undefined,
      notes: form.notes || undefined,
      referredBy: form.referredBy.trim() || undefined,
      ownerName: form.ownerName.trim() || undefined,
      ownerContact: form.ownerContact.trim() || undefined,
      documentPath: docPath || undefined,
      documentName: docName || undefined,
      advancedPayment: (form.transaction === 'For Rent' && form.advancedPayment) ? form.advancedPayment : undefined,
      photos: photos.length > 0 ? photos : undefined,
    }
    let savedId = initial?.id ?? ++_nextId
    try {
      const res = await fetch('/api/properties', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: initial!.id, ...payload } : payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveError(data.error || 'Could not save. Please try again.'); setSaving(false); return }
      if (data.property?.id) savedId = data.property.id
    } catch {
      setSaveError('Network error. Please try again.'); setSaving(false); return
    }
    const p: Property = { id: savedId, ...payload, agentId, advancedPayment: payload.advancedPayment as AdvancedPayment | undefined }
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
      onClick={e => { if (e.target === e.currentTarget) { setTemplateOpen(false); onClose() } }}
    >
      <div className="w-full md:max-w-md md:rounded-2xl rounded-t-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <p className="text-base font-bold" style={{ color: '#14223F' }}>{editing ? 'Edit Listing' : 'New Listing'}</p>
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
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{propertyTypeLabel(t)}</option>)}
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

          {/* Size + Beds + Baths + Parking */}
          <div className="grid grid-cols-4 gap-2">
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
            <div>
              <label className={label} style={labelStyle}>Parking</label>
              <input className={inp} style={inpStyle} type="number" value={form.parkings} onChange={e => set('parkings', e.target.value)} placeholder="1" />
            </div>
          </div>

          {/* View + Building Age */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} style={labelStyle}>View</label>
              <input className={inp} style={inpStyle} value={form.view} onChange={e => set('view', e.target.value)} placeholder="Sea, Mountain, City…" />
            </div>
            <div>
              <label className={label} style={labelStyle}>Building Age (yrs)</label>
              <input className={inp} style={inpStyle} type="number" value={form.buildingAge} onChange={e => set('buildingAge', e.target.value)} placeholder="e.g. 15" />
            </div>
          </div>

          {/* Features */}
          <div className="flex gap-4 pt-1 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.garden} onChange={e => set('garden', e.target.checked)} className="rounded" />
              Garden
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.balcony} onChange={e => set('balcony', e.target.checked)} className="rounded" />
              Balcony
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.terrace} onChange={e => set('terrace', e.target.checked)} className="rounded" />
              Terrace
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#14223F' }}>
              <input type="checkbox" checked={form.needsRenovation} onChange={e => set('needsRenovation', e.target.checked)} className="rounded" />
              Needs Renovation
            </label>
          </div>

          {/* Furnishing — tick boxes, single choice */}
          <div>
            <label className={label} style={labelStyle}>Furnishing</label>
            <div className="flex gap-2 flex-wrap">
              {FURNISHINGS.map(f => {
                const on = form.furnishing === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => set('furnishing', on ? '' : f)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
                    style={{
                      border: on ? '1.5px solid #2E5288' : '1.5px solid #EEF0F4',
                      background: on ? '#EAF0FA' : '#F7F8FB',
                      color: on ? '#2E5288' : '#6A7488',
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center text-[10px] text-white"
                      style={{ background: on ? '#2E5288' : '#fff', border: on ? 'none' : '1.5px solid #C4CAD6' }}
                    >{on ? '✓' : ''}</span>
                    {f}
                  </button>
                )
              })}
            </div>
          </div>

          {/* AI Description */}
          <div>
            <label className={label} style={labelStyle}>
              AI Description <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(client-facing)</span>
            </label>

            {/* Template picker + Generate row */}
            <div className="flex gap-2 mb-2">
              {/* Template selector */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => setTemplateOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-medium"
                  style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB', color: selectedTemplate ? '#14223F' : '#9AA3B2' }}
                >
                  <span className="truncate">{selectedTemplate ? selectedTemplate.name : 'No template'}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-1" style={{ color: '#9AA3B2' }} />
                </button>
                {templateOpen && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10"
                    style={{ background: '#fff', border: '1.5px solid #EEF0F4', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                  >
                    <button
                      type="button"
                      onClick={() => { setSelectedTemplateId('none'); setTemplateOpen(false) }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                      style={{ color: selectedTemplateId === 'none' ? '#2E5288' : '#6A7488', fontWeight: selectedTemplateId === 'none' ? 600 : 400 }}
                    >
                      No template
                    </button>
                    {templates.length === 0 && (
                      <p className="px-3 py-2 text-xs italic" style={{ color: '#B0B8C8' }}>No templates saved yet — add them in Profile settings.</p>
                    )}
                    {templates.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setSelectedTemplateId(t.id); setTemplateOpen(false) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                        style={{ borderTop: '1px solid #F4F5F8' }}
                      >
                        <p className="text-xs font-semibold" style={{ color: selectedTemplateId === t.id ? '#2E5288' : '#14223F' }}>{t.name}</p>
                        <p className="text-xs mt-0.5 line-clamp-1" style={{ color: '#9AA3B2' }}>{t.body}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate button */}
              <button
                type="button"
                onClick={handleAiDescription}
                disabled={aiLoading}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-60 shrink-0"
                style={{ background: '#EAF0FA', color: '#2E5288' }}
              >
                {aiLoading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-3 w-3" /> Generate</>
                }
              </button>
            </div>

            {aiError && <p className="text-xs mb-1" style={{ color: '#A23434' }}>{aiError}</p>}
            <textarea
              className={inp}
              style={{ ...inpStyle, resize: 'none' }}
              rows={3}
              value={form.aiDescription}
              onChange={e => set('aiDescription', e.target.value)}
              placeholder="Generate with AI or write a marketing description…"
              onClick={() => setTemplateOpen(false)}
            />
          </div>

          {/* Internal Notes */}
          <div>
            <label className={label} style={labelStyle}>
              Internal Notes <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(private)</span>
            </label>
            <textarea
              className={inp}
              style={{ ...inpStyle, resize: 'none' }}
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Private notes for the team…"
              onClick={() => setTemplateOpen(false)}
            />
          </div>

          {/* Referred by — partner company/agent, for co-brokering */}
          <div>
            <label className={label} style={labelStyle}>
              Referred by <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(partner company or agent)</span>
            </label>
            <input className={inp} style={inpStyle} value={form.referredBy} onChange={e => set('referredBy', e.target.value)} placeholder="e.g. Prime Realty / Karim H." />
          </div>

          {/* Photos */}
          <div>
            <label className={label} style={labelStyle}>
              Photos {photos.length > 1 && <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(first is the cover — use ◀ ▶ to reorder)</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {photos.map((src, i) => (
                <div key={src} className="relative rounded-xl overflow-hidden" style={{ width: 84, height: 62 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 py-0.5 rounded text-white leading-none" style={{ background: 'rgba(46,82,136,0.92)' }}>
                      COVER
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center text-xs leading-none"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                  >✕</button>
                  {photos.length > 1 && (
                    <div className="absolute bottom-0 left-0 right-0 flex justify-between px-0.5 py-0.5" style={{ background: 'rgba(0,0,0,0.35)' }}>
                      <button type="button" disabled={i === 0} onClick={() => movePhoto(i, i - 1)} className="text-white disabled:opacity-30 leading-none">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={i === photos.length - 1} onClick={() => movePhoto(i, i + 1)} className="text-white disabled:opacity-30 leading-none">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex flex-col items-center justify-center rounded-xl gap-1 text-xs font-medium transition-colors hover:bg-blue-50 disabled:opacity-50"
                style={{ width: 84, height: 62, border: '1.5px dashed #C4CAD6', color: '#7A8499' }}
              >
                <ImagePlus className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Add'}
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
            {photoError && (
              <p className="text-xs mt-1.5" style={{ color: '#A23434' }}>{photoError}</p>
            )}
          </div>

          {/* Video — a walkthrough clip uploaded from the phone */}
          <div>
            <label className={label} style={labelStyle}>
              Video <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(a walkthrough clip, max {Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB)</span>
            </label>
            {form.video ? (
              <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #EEF0F4', background: '#000' }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={form.video} controls className="w-full" style={{ maxHeight: 200 }} />
                <button
                  type="button"
                  onClick={() => set('video', '')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold"
                  style={{ background: '#F7F8FB', color: '#A23434' }}
                >
                  <X className="h-3.5 w-3.5" /> Remove video
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={videoUploading}
                className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-medium transition-colors hover:bg-blue-50 disabled:opacity-50"
                style={{ border: '1.5px dashed #C4CAD6', color: '#7A8499' }}
              >
                {videoUploading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
                  : <><Video className="h-4 w-4" /> Upload a video</>}
              </button>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={e => handleVideoFile(e.target.files)}
            />
            {videoError && <p className="text-xs mt-1.5" style={{ color: '#A23434' }}>{videoError}</p>}
          </div>

          {/* ── Private section — assigned agent + managers only ── */}
          <div className="pt-1 mt-1" style={{ borderTop: '1px dashed #E4E7EE' }}>
            <p className="text-xs font-bold mt-2 mb-1" style={{ color: '#8A5A24' }}>
              🔒 Private — only you and managers can see this
            </p>

            {/* Owner name + number */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} style={labelStyle}>Owner name</label>
                <input className={inp} style={inpStyle} value={form.ownerName} onChange={e => set('ownerName', e.target.value)} placeholder="e.g. Mr Khoury" />
              </div>
              <div>
                <label className={label} style={labelStyle}>Owner number</label>
                <input className={inp} style={inpStyle} value={form.ownerContact} onChange={e => set('ownerContact', e.target.value)} placeholder="e.g. 03 123 456" />
              </div>
            </div>

            {/* Exact location — Google Maps link (private) */}
            <div className="mt-3">
              <label className={label} style={labelStyle}>
                Exact location <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(Google Maps link)</span>
              </label>
              <div className="flex gap-2">
                <input
                  className={inp} style={inpStyle} value={form.mapUrl}
                  onChange={e => set('mapUrl', e.target.value)}
                  placeholder="Paste a Google Maps pin link…"
                />
                <button
                  type="button"
                  onClick={() => {
                    const q = form.mapUrl.trim()
                    // Open the pasted pin if there is one, otherwise a Maps search
                    // for the address so the agent can grab the pin and paste it.
                    const addr = [form.district, form.city].filter(Boolean).join(', ')
                    const url = q
                      ? (/^https?:\/\//i.test(q) ? q : `https://www.google.com/maps/search/${encodeURIComponent(q)}`)
                      : `https://www.google.com/maps/search/${encodeURIComponent(addr || 'Lebanon')}`
                    window.open(url, '_blank', 'noopener')
                  }}
                  className="flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold shrink-0"
                  style={{ background: '#EAF0FA', color: '#2E5288' }}
                >
                  <MapPin className="h-3.5 w-3.5" /> Open
                </button>
              </div>
            </div>

            {/* Private document */}
            <div className="mt-3">
              <label className={label} style={labelStyle}>
                Document <span style={{ color: '#B0B8C8', fontWeight: 400 }}>(PDF, Word or photo)</span>
              </label>
              {docPath ? (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ border: '1.5px solid #EEF0F4', background: '#F7F8FB' }}>
                  <FileText className="h-4 w-4 shrink-0" style={{ color: '#2E5288' }} />
                  <span className="text-sm truncate flex-1" style={{ color: '#14223F' }}>{docName || 'Document attached'}</span>
                  <button type="button" onClick={() => { setDocPath(''); setDocName('') }} style={{ color: '#9AA3B2' }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => docInputRef.current?.click()}
                  disabled={docUploading}
                  className="flex items-center justify-center gap-2 w-full rounded-xl py-2 text-sm font-medium transition-colors hover:bg-blue-50 disabled:opacity-50"
                  style={{ border: '1.5px dashed #C4CAD6', color: '#7A8499' }}
                >
                  <FileText className="h-4 w-4" />
                  {docUploading ? 'Uploading…' : 'Attach a document'}
                </button>
              )}
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={e => handleDocFile(e.target.files)}
              />
              {docError && <p className="text-xs mt-1.5" style={{ color: '#A23434' }}>{docError}</p>}
            </div>
          </div>
        </div>

        <div className="px-5 py-4" style={{ borderTop: '1px solid #EEF0F4' }}>
          {dupes.length > 0 && (
            <div className="rounded-xl p-3 mb-2" style={{ background: '#FBEFD6', border: '1px solid #E9CE90' }}>
              <p className="text-xs font-bold" style={{ color: '#9A6516' }}>Possible duplicate listing</p>
              <ul className="text-xs mt-1 space-y-0.5" style={{ color: '#7A5510' }}>
                {dupes.map(d => <li key={d.id}>• {d.title}</li>)}
              </ul>
              <p className="text-[11px] mt-1.5" style={{ color: '#9A6516' }}>Save anyway if this is a different unit.</p>
            </div>
          )}
          {saveError && <p className="text-xs mb-2" style={{ color: '#A23434' }}>{saveError}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 rounded-xl py-2 text-sm font-semibold" style={{ border: '1.5px solid #EEF0F4', color: '#6A7488' }}>
              Cancel
            </button>
            <button
              onClick={() => handleSave(dupes.length > 0)}
              disabled={!form.title || !form.city || uploading || docUploading || videoUploading || saving}
              className="flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: dupes.length > 0 ? '#9A6516' : '#0E1F3D' }}
            >
              {uploading ? 'Uploading…' : saving ? 'Saving…' : dupes.length > 0 ? 'Save anyway' : editing ? 'Save changes' : 'Save listing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
