import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-guard'

export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('Companies')
      .select('id, Name, domain, Plan, "is active", access_status, access_until, created_at')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ companies: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const { id, active, access_until } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = createAdminClient()
    const update: Record<string, unknown> = {
      'is active': active,
      access_status: active ? 'active' : 'pending',
    }
    if (access_until !== undefined) update.access_until = access_until
    const { error } = await supabase.from('Companies').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
