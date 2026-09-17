import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recalculateScores } from '@/lib/score-engine'
import { getSession, companyAccessBlocked } from '@/lib/session'
import { loadClients } from '@/lib/api-loaders'
import { canEditClient, isManager } from '@/lib/permissions'
import { CLOSING_DOC_PRESETS } from '@/lib/data'
import { notifyAgentNewClient } from '@/lib/whatsapp/notify'
import { ensureManagerAgentCode } from '@/lib/ensure-manager-code'


// The owning agent code lives in the client's notes JSON.
function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

// Free-form labels: strings only, trimmed, de-duped, capped so a bad payload
// can't bloat the row.
function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const v = t.trim().slice(0, 24)
    if (v) seen.add(v)
  }
  return [...seen].slice(0, 12)
}

// Closing paperwork: a down payment amount plus a capped list of document
// references (label/path/name/uploadedAt). Storage paths are opaque strings
// already scoped to the company by /api/upload/document — we just cap the
// list size and shape here so a bad payload can't bloat the row.
function sanitizeClosing(raw: unknown): { downPayment?: number; downPaymentWaived?: boolean; documents: unknown[] } {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const downPaymentWaived = r.downPaymentWaived === true
  // Waived and an amount are mutually exclusive — waived wins if somehow both are sent.
  const downPayment = !downPaymentWaived && typeof r.downPayment === 'number' && r.downPayment >= 0 ? r.downPayment : undefined
  const docsIn = Array.isArray(r.documents) ? r.documents : []
  const documents = docsIn.slice(0, 20).map(d => {
    const doc = (d && typeof d === 'object') ? d as Record<string, unknown> : {}
    return {
      label: typeof doc.label === 'string' ? doc.label.trim().slice(0, 60) : 'Document',
      ...(typeof doc.part === 'string' && doc.part.trim() ? { part: doc.part.trim().slice(0, 60) } : {}),
      path: typeof doc.path === 'string' ? doc.path.slice(0, 300) : '',
      name: typeof doc.name === 'string' ? doc.name.slice(0, 200) : 'file',
      uploadedAt: typeof doc.uploadedAt === 'string' ? doc.uploadedAt.slice(0, 40) : new Date().toISOString(),
    }
  }).filter(d => d.path)
  return { ...(downPayment !== undefined ? { downPayment } : {}), ...(downPaymentWaived ? { downPaymentWaived } : {}), documents }
}

// A client change is a scoring signal — refresh that client's lead score.
// Deferred with after() so the write returns immediately: re-scoring loads the
// company's clients/properties/deals and was making every save wait on it. The
// new score lands a moment later and shows on the next read. Non-fatal.
function refreshScoreAfter(clientId: number, companyId: number) {
  after(async () => { try { await recalculateScores({ clientId, companyId }) } catch { /* ignore */ } })
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const supabase = await createClient()
    const agentFilter = req.nextUrl.searchParams.get('agent')
    return NextResponse.json({ clients: await loadClients(supabase, session, agentFilter) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = await createClient()

    // Only the owning agent (or a manager) may change a client.
    const { data: existing } = await supabase
      .from('client_requests').select('id,notes').eq('id', id).eq('company_id', session.companyId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canEditClient(session, clientAgent(existing))) {
      return NextResponse.json({ error: 'Forbidden — this client belongs to another agent' }, { status: 403 })
    }

    // Build a partial update from whatever fields were sent. A status-only
    // payload ({ id, status }) updates just the status; a full edit updates
    // the client details too.
    const update: Record<string, unknown> = {}
    // Set when this request completes the closing checklist (down payment +
    // ID + down payment proof + signed contract) — cascades the deal to
    // Closed/Won and the client to Signed after the write succeeds.
    let closingJustCompleted = false
    if (body.status !== undefined) update.status = body.status
    if (body.agent_rating !== undefined) {
      const stars = Number(body.agent_rating)
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return NextResponse.json({ error: 'agent_rating must be 1-5' }, { status: 400 })
      }
      update.agent_rating = stars
    }
    if (body.name !== undefined) update['Client Name'] = body.name
    if (body.phone !== undefined) update['client phone'] = body.phone
    if (body.req?.location !== undefined) update['prefered-location'] = body.req.location
    if (body.req?.priceMin !== undefined) update.budget_min = body.req.priceMin
    if (body.budget !== undefined || body.req?.priceMax !== undefined) {
      update.budget_max = body.budget ?? body.req?.priceMax ?? 0
    }
    if (body.req?.beds !== undefined) update.bedrooms = body.req.beds
    if (body.req?.transaction !== undefined) update.payment_terms = body.req.transaction
    if (body.name !== undefined || body.email !== undefined || body.type !== undefined || body.req !== undefined || body.tags !== undefined || body.closing !== undefined) {
      // Merge onto the existing notes so a partial update (e.g. tags-only)
      // never wipes email / agentId / req that weren't resent.
      let prev: Record<string, unknown> = {}
      try { prev = JSON.parse((existing.notes as string) || '{}') } catch { /* start fresh */ }
      const merged = {
        ...prev,
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        ...(body.req !== undefined ? { req: body.req } : {}),
        ...(body.tags !== undefined ? { tags: sanitizeTags(body.tags) } : {}),
        ...(body.closing !== undefined ? { closing: sanitizeClosing(body.closing) } : {}),
      }
      update.notes = JSON.stringify(merged)

      if (body.closing !== undefined) {
        const closing = merged.closing as { downPayment?: number; downPaymentWaived?: boolean; documents: { label: string }[] } | undefined
        const labels = new Set((closing?.documents ?? []).map(d => d.label))
        // A down payment isn't universal — rentals and some sellers skip it
        // entirely, so a waived down payment counts the same as a set amount.
        const downPaymentDone = closing?.downPaymentWaived === true || closing?.downPayment != null
        const requiredDocs = closing?.downPaymentWaived === true
          ? CLOSING_DOC_PRESETS.filter(p => p !== 'Down Payment Proof')
          : CLOSING_DOC_PRESETS
        closingJustCompleted = downPaymentDone && requiredDocs.every(p => labels.has(p))
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('client_requests')
      .update(update)
      .eq('id', id)
      .eq('company_id', session.companyId)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    refreshScoreAfter(Number(id), session.companyId)

    // The closing checklist just became complete: move the deal to Closed/Won
    // and the client to Signed. Deferred so the save itself returns instantly;
    // best-effort — a failed cascade never fails the checklist save.
    if (closingJustCompleted) {
      after(async () => {
        try {
          const admin = createAdminClient()
          const { data: deal } = await admin
            .from('deals').select('id,stage,property_id').eq('client_id', id).eq('company_id', session.companyId).maybeSingle()
          if (deal && deal.stage !== 'closed') {
            await admin.from('deals').update({ stage: 'closed', outcome: 'won' }).eq('id', deal.id)
          }
          if (body.status === undefined) {
            await admin.from('client_requests').update({ status: 'Signed' }).eq('id', id).eq('company_id', session.companyId)
          }
          // The deal closing means the property it was for is off the market —
          // flip it to Sold/Rented so it stops showing as Available elsewhere.
          if (deal?.property_id) {
            const { data: prop } = await admin
              .from('Properties').select('id,Status,Amenities').eq('id', deal.property_id).eq('company_id', session.companyId).maybeSingle()
            if (prop && prop.Status !== 'Sold' && prop.Status !== 'Rented') {
              let isRent = false
              try { isRent = /rent/i.test(String(JSON.parse((prop.Amenities as string) || '{}').transaction ?? '')) } catch { /* default to Sold */ }
              await admin.from('Properties').update({ Status: isRent ? 'Rented' : 'Sold' }).eq('id', prop.id)
            }
          }
        } catch { /* best-effort cascade */ }
      })
    }

    return NextResponse.json({ ok: true, client: data, closingJustCompleted })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const body = await req.json()
    const supabase = await createClient()

    // An agent always creates clients under their own code. A manager may assign
    // to any agent — but if they don't pick one, the client is theirs (managers
    // work deals too), so mint their code if it's missing.
    let ownerAgent: string | null
    if (isManager(session.role)) {
      let managerCode = session.agentCode
      if (!managerCode) {
        managerCode = await ensureManagerAgentCode(createAdminClient(), session.companyId, session.userId, session.fullName)
      }
      ownerAgent = body.agentId || managerCode || null
    } else {
      ownerAgent = session.agentCode ?? body.agentId ?? null
    }

    // Pack extra UI fields into notes JSON
    const extras = {
      email: body.email,
      type: body.type,
      agentId: ownerAgent,
      req: body.req,
      tags: sanitizeTags(body.tags),
    }

    // Agent_id is a uuid column; the UI's agentId is a mock code like "a1",
    // so only store it when it's an actual uuid (otherwise it lives in notes).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const agentUuid = typeof body.agentId === 'string' && UUID_RE.test(body.agentId) ? body.agentId : null

    const { data, error } = await supabase
      .from('client_requests')
      .insert({
        company_id: session.companyId,
        Agent_id: agentUuid,
        'Client Name': body.name,
        'client phone': body.phone ?? null,
        budget_min: body.req?.priceMin ?? 0,
        budget_max: body.budget ?? body.req?.priceMax ?? 0,
        'prefered-location': body.req?.location ?? null,
        bedrooms: body.req?.beds ?? null,
        payment_terms: body.req?.transaction ?? null,
        notes: JSON.stringify(extras),
        status: body.status ?? 'Searching',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (data?.id) refreshScoreAfter(Number(data.id), session.companyId)

    // Ping the responsible agent on WhatsApp to reach out — but only when the
    // client was assigned to someone OTHER than the person adding it (a manager
    // assigning to an agent). Deferred so the save returns immediately; non-fatal.
    after(async () => {
      try {
        await notifyAgentNewClient({
          companyId: session.companyId,
          ownerAgentCode: ownerAgent,
          actorAgentCode: session.agentCode,
          client: {
            name: body.name,
            phone: body.phone,
            type: body.type,
            budget: body.budget ?? body.req?.priceMax,
            location: body.req?.location,
          },
        })
      } catch { /* notification is best-effort */ }
    })

    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Delete a client. Same rule as editing: their own agent or a manager. The
// database removes what belongs to them (their deal with its offers and stage
// history, follow-up reminders, match alerts); calendar events stay but lose
// the client link.
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await companyAccessBlocked(session)) {
    return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
  }

  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid client id is required.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('client_requests').select('id,notes').eq('id', id).eq('company_id', session.companyId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  if (!canEditClient(session, clientAgent(existing))) {
    return NextResponse.json({ error: 'Only the client\'s agent or a manager can delete them.' }, { status: 403 })
  }

  const { error } = await admin.from('client_requests').delete().eq('id', id).eq('company_id', session.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id })
}
