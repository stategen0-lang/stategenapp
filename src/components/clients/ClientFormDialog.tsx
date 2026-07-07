'use client'

import { useState, useEffect } from 'react'
import { ClientRequest } from '@/types/database'
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
  client: ClientRequest | null
  companyId: number
  agentId: string
  onSaved: (c: ClientRequest) => void
}

type FormState = Record<string, string>

const blank: FormState = {
  'Client Name': '', 'client phone': '', 'prefered-location': '',
  budget_min: '', budget_max: '', bedrooms: '',
  payment_terms: '', notes: '', status: 'active',
}

export default function ClientFormDialog({ open, onOpenChange, client, companyId, agentId, onSaved }: Props) {
  const supabase = createClient()
  const [form, setForm] = useState<FormState>(blank)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (client) {
      setForm({
        'Client Name': client['Client Name'] ?? '',
        'client phone': client['client phone'] ?? '',
        'prefered-location': client['prefered-location'] ?? '',
        budget_min: client.budget_min?.toString() ?? '',
        budget_max: client.budget_max?.toString() ?? '',
        bedrooms: client.bedrooms?.toString() ?? '',
        payment_terms: client.payment_terms ?? '',
        notes: client.notes ?? '',
        status: client.status ?? 'active',
      })
    } else {
      setForm(blank)
    }
    setError(null)
  }, [client, open])

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const payload = {
      company_id: companyId,
      Agent_id: agentId,
      'Client Name': form['Client Name'],
      'client phone': form['client phone'] || null,
      'prefered-location': form['prefered-location'] || null,
      budget_min: form.budget_min ? parseFloat(form.budget_min) : null,
      budget_max: form.budget_max ? parseFloat(form.budget_max) : null,
      bedrooms: form.bedrooms ? parseInt(form.bedrooms) : null,
      payment_terms: form.payment_terms || null,
      notes: form.notes || null,
      status: form.status,
    }

    let result
    if (client) {
      result = await supabase.from('client_requests').update(payload).eq('id', client.id).select().single()
    } else {
      result = await supabase.from('client_requests').insert(payload).select().single()
    }

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }

    onSaved(result.data as ClientRequest)
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? 'Edit Client' : 'Add Client'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Client Name *</Label>
            <Input value={form['Client Name']} onChange={(e) => set('Client Name', e.target.value)} required className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>WhatsApp / Phone</Label>
              <Input
                value={form['client phone']}
                onChange={(e) => set('client phone', e.target.value)}
                placeholder="+20 1xx xxx xxxx"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v ?? 'active')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Preferred Location</Label>
            <Input
              value={form['prefered-location']}
              onChange={(e) => set('prefered-location', e.target.value)}
              placeholder="e.g. New Cairo, Maadi, 6th of October"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Budget Min</Label>
              <Input type="number" value={form.budget_min} onChange={(e) => set('budget_min', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Budget Max</Label>
              <Input type="number" value={form.budget_max} onChange={(e) => set('budget_max', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Bedrooms</Label>
              <Input type="number" value={form.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} placeholder="Cash, Installment…" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any additional requirements…" className="mt-1 h-20" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : client ? 'Save Changes' : 'Add Client'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
