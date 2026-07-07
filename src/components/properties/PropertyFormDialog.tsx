'use client'

import { useState, useEffect } from 'react'
import { Property } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  property: Property | null
  companyId: number
  agentId: string
  onSaved: (p: Property) => void
}

const AMENITY_OPTIONS = ['Pool', 'Gym', 'Parking', 'Security', 'Elevator', 'Garden', 'Balcony', 'Storage', 'Generator', 'Concierge']

const blank = {
  Title: '', Location: '', Neighborhood: '', Price: '', Currency: 'EGP',
  Bedrooms: '', bathrooms: '', size: '', Floor_num: '',
  'Floor Type': '', Payment_terms: '', Status: 'available',
  Amenities: '[]', Photos: '[]',
}

export default function PropertyFormDialog({ open, onOpenChange, property, companyId, onSaved }: Props) {
  const supabase = createClient()
  const [form, setForm] = useState(blank)
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const [photoUrls, setPhotoUrls] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (property) {
      setForm({
        Title: property.Title ?? '',
        Location: property.Location ?? '',
        Neighborhood: property.Neighborhood ?? '',
        Price: property.Price?.toString() ?? '',
        Currency: property.Currency ?? 'EGP',
        Bedrooms: property.Bedrooms?.toString() ?? '',
        bathrooms: property.bathrooms?.toString() ?? '',
        size: property.size?.toString() ?? '',
        Floor_num: property.Floor_num?.toString() ?? '',
        'Floor Type': property['Floor Type'] ?? '',
        Payment_terms: property.Payment_terms ?? '',
        Status: property.Status ?? 'available',
        Amenities: property.Amenities ?? '[]',
        Photos: property.Photos ?? '[]',
      })
      try { setSelectedAmenities(JSON.parse(property.Amenities ?? '[]')) } catch { setSelectedAmenities([]) }
      try {
        const urls = JSON.parse(property.Photos ?? '[]') as string[]
        setPhotoUrls(urls.join('\n'))
      } catch { setPhotoUrls('') }
    } else {
      setForm(blank)
      setSelectedAmenities([])
      setPhotoUrls('')
    }
    setError(null)
  }, [property, open])

  function toggleAmenity(a: string) {
    setSelectedAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    )
  }

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const photos = photoUrls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean)

    const payload = {
      company_id: companyId,
      Title: form.Title,
      Location: form.Location || null,
      Neighborhood: form.Neighborhood || null,
      Price: form.Price ? parseFloat(form.Price) : null,
      Currency: form.Currency || null,
      Bedrooms: form.Bedrooms ? parseInt(form.Bedrooms) : null,
      bathrooms: form.bathrooms ? parseInt(form.bathrooms) : null,
      size: form.size ? parseFloat(form.size) : null,
      Floor_num: form.Floor_num ? parseInt(form.Floor_num) : null,
      'Floor Type': form['Floor Type'] || null,
      Payment_terms: form.Payment_terms || null,
      Status: form.Status,
      Amenities: JSON.stringify(selectedAmenities),
      Photos: JSON.stringify(photos),
    }

    let result
    if (property) {
      result = await supabase.from('Properties').update(payload).eq('id', property.id).select().single()
    } else {
      result = await supabase.from('Properties').insert(payload).select().single()
    }

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }

    onSaved(result.data as Property)
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? 'Edit Property' : 'Add Property'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Title *</Label>
            <Input value={form.Title} onChange={(e) => set('Title', e.target.value)} required className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Location</Label>
              <Input value={form.Location} onChange={(e) => set('Location', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Neighborhood</Label>
              <Input value={form.Neighborhood} onChange={(e) => set('Neighborhood', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Price</Label>
              <Input type="number" value={form.Price} onChange={(e) => set('Price', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.Currency} onValueChange={(v) => set('Currency', v ?? 'EGP')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGP">EGP</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AED">AED</SelectItem>
                  <SelectItem value="SAR">SAR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Bedrooms</Label>
              <Input type="number" value={form.Bedrooms} onChange={(e) => set('Bedrooms', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Bathrooms</Label>
              <Input type="number" value={form.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Size (m²)</Label>
              <Input type="number" value={form.size} onChange={(e) => set('size', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Floor No.</Label>
              <Input type="number" value={form.Floor_num} onChange={(e) => set('Floor_num', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Floor Type</Label>
              <Input value={form['Floor Type']} onChange={(e) => set('Floor Type', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.Payment_terms} onChange={(e) => set('Payment_terms', e.target.value)} placeholder="Cash, Installment…" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.Status} onValueChange={(v) => set('Status', v ?? 'available')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
                <SelectItem value="sold">Sold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Amenities</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {AMENITY_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAmenity(a)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    selectedAmenities.includes(a)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Photo URLs (one per line)</Label>
            <Textarea
              value={photoUrls}
              onChange={(e) => setPhotoUrls(e.target.value)}
              placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
              className="mt-1 h-24 font-mono text-xs"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : property ? 'Save Changes' : 'Add Property'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
