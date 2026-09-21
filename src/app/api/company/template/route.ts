import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { sanitizeTemplates, activeBody } from '@/lib/templates'
import { createAdminClient } from '@/lib/supabase/admin'

// The company's shared templates: the AI description style, and the pattern that
// writes listing titles ([furnished][size][type][for sale/rent] in [location]).
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
  // select('*') so a missing migration 026 degrades to "no title template" rather
  // than erroring for everyone.
  const { data } = await admin
    .from('Companies')
    .select('*')
    .eq('id', session.companyId)
    .maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>

  // The whole list, so every agent sees what their manager wrote (it used to
  // live only in the manager's own browser).
  let templates: unknown = []
  try { templates = JSON.parse((row.description_templates as string) || '[]') } catch { templates = [] }

  return NextResponse.json({
    template: (row.description_template as string | null) ?? null,
    titleTemplate: (row.title_template as string | null) ?? null,
    templates: sanitizeTemplates(templates),
  })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The house-style template is shared agency-wide, so only managers set it.
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  // Either template can be sent on its own; only what is present is written.
  const update: Record<string, string | null> = {}
  try {
    const body = await req.json()
    if ('template' in (body ?? {})) {
      update.description_template = typeof body.template === 'string' && body.template.trim() ? body.template : null
    }
    if ('templates' in (body ?? {})) {
      // The list is the source of truth; description_template follows its active
      // entry so the WhatsApp bot keeps working unchanged.
      const clean = sanitizeTemplates(body.templates)
      update.description_templates = clean.length ? JSON.stringify(clean) : null
      update.description_template = activeBody(clean)
    }
    if ('titleTemplate' in (body ?? {})) {
      const t = body.titleTemplate
      update.title_template = typeof t === 'string' && t.trim() ? t.trim().slice(0, 300) : null
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('Companies')
    .update(update)
    .eq('id', session.companyId)

  if (error) {
    if (/title_template/.test(error.message)) return NextResponse.json({ error: 'Run database migration 026 first.' }, { status: 500 })
    if (/description_templates/.test(error.message)) return NextResponse.json({ error: 'Run database migration 027 first.' }, { status: 500 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, template: update.description_template, titleTemplate: update.title_template })
}
