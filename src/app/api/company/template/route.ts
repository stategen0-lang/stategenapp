import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'

// The company's active AI description template.
//
// Templates are edited in the browser (localStorage), but the server — and the
// WhatsApp bot — needs the chosen one too. Settings mirrors the active template
// here whenever it changes; the WhatsApp "write a description" flow reads it.
//
// One shared house-style template per company. Writes use the admin client after
// the session is verified (RLS on Companies is otherwise restrictive, and the
// Profiles-RLS recursion has bitten authenticated reads before).

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('Companies')
    .select('description_template')
    .eq('id', session.companyId)
    .maybeSingle()

  return NextResponse.json({ template: (data?.description_template as string | null) ?? null })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The house-style template is shared agency-wide, so only managers set it.
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  let template: string | null = null
  try {
    const body = await req.json()
    const t = body?.template
    template = typeof t === 'string' && t.trim() ? t : null
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('Companies')
    .update({ description_template: template })
    .eq('id', session.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, template })
}
