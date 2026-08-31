import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Public: a lead submitted from an agency microsite → a new (unassigned) client
// in that agency's CRM, tagged source 'website'. No auth (the agency is keyed by
// the microsite slug); a honeypot + required-field checks blunt bot spam.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as Record<string, string>

  // Honeypot: real users never fill the hidden "company" field. Pretend success.
  if (b.company && b.company.trim()) return NextResponse.json({ ok: true })

  const name = (b.name ?? '').trim().slice(0, 120)
  const phone = (b.phone ?? '').trim().slice(0, 40)
  const slug = (b.slug ?? '').trim()
  if (!name || !phone || !slug) return NextResponse.json({ error: 'Name and phone are required.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: company } = await admin.from('Companies').select('id').eq('domain', slug).maybeSingle()
  if (!company) return NextResponse.json({ error: 'Agency not found.' }, { status: 404 })

  const clientType = b.clientType === 'renter' ? 'Renter' : 'Buyer'
  const transaction = clientType === 'Renter' ? 'For Rent' : 'For Sale'
  const budget = Number(b.budget) || 0
  const location = (b.location ?? '').trim().slice(0, 80)
  const propertyType = (b.propertyType ?? '').trim().slice(0, 40)
  const message = (b.message ?? '').trim().slice(0, 500)

  const wants: Record<string, unknown> = { type: propertyType || undefined, location: location || undefined }
  const notes = { type: clientType, agentId: null, req: wants, source: 'website', message: message || undefined }

  const { error } = await admin.from('client_requests').insert({
    company_id: (company as { id: number }).id,
    'Client Name': name,
    'client phone': phone,
    'prefered-location': location || null,
    budget_min: budget,
    budget_max: budget,
    payment_terms: transaction,
    status: 'New',
    notes: JSON.stringify(notes),
  })
  if (error) return NextResponse.json({ error: 'Could not save your request. Please try again.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
