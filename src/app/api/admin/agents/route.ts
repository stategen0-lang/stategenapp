import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-guard'

// GET  /api/admin/agents?companyId=X  — list agents for a company
// PATCH /api/admin/agents              — { id: userId, approved: bool }
export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const companyId = req.nextUrl.searchParams.get('companyId')
    if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('Profiles')
      .select('id, Full_name, role, agent_code, approved, created_at')
      .eq('company_id', Number(companyId))
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ agents: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const { id, approved } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('Profiles')
      .update({ approved })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
