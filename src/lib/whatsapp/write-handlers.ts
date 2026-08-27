// Phase 3 — write flows, all behind confirm-before-write.
//
// The shape of every flow is the same:
//
//   stage*()  validates permission + fields, writes a pending_actions row,
//             and replies with exactly what will change
//   applyPendingAction()  runs only after the agent says YES
//
// Nothing here writes to a business table directly from an inbound message.
// Permission is checked twice — when staging and again when applying — because
// the two are separate requests and roles can change in between.

import type { SupabaseClient } from '@supabase/supabase-js'
import { canEditClient, canEditProperty, canSeeClientPII, isManager, maskClientName } from '@/lib/permissions'
import type { IntentResult } from '@/lib/whatsapp/intent'
import { stageLabel } from '@/lib/whatsapp/deals'
import type { Stage } from '@/lib/pipeline'
import { dbRowToProperty } from '@/lib/db-mappers'
import { generateDescription, type DescriptionInput } from '@/lib/ai/property-description'
import {
  buildUpdate, buildNewProperty, confirmationText, hasChanges,
  mergeExtras, appendLog, CLIENT_FIELDS, PROPERTY_FIELDS,
} from '@/lib/whatsapp/writes'
import { reminderOutcome } from '@/lib/whatsapp/reminders'
import { splitClientRef } from '@/lib/whatsapp/client-ref'
import type { ReminderAction } from '@/lib/whatsapp/replies'
import { createListingAlerts } from '@/lib/alerts-server'
import { applyOfferAction } from '@/lib/offers-server'

export interface Profile {
  id: string
  company_id: number
  role: string
  agent_code: string | null
  Full_name: string | null
}

function toSession(p: Profile) {
  return {
    userId: p.id,
    companyId: p.company_id,
    role: p.role as 'owner' | 'manager' | 'agent',
    agentCode: p.agent_code,
    fullName: p.Full_name ?? 'Agent',
    approved: true,
  }
}

function agentOf(row: Record<string, unknown>, blobColumn: string): string | null {
  try { return (JSON.parse((row[blobColumn] as string) || '{}').agentId as string) ?? null } catch { return null }
}

/**
 * How to refer to a client in a reply. A refusal must not leak the name it is
 * refusing to show — "Ziad belongs to another agent" defeats the masking that
 * the query path carefully applies.
 */
function clientLabel(profile: Profile, row: Record<string, unknown>): string {
  return canSeeClientPII(toSession(profile), agentOf(row, 'notes'))
    ? (row['Client Name'] as string)
    : maskClientName(Number(row.id))
}

/** What a pending_actions row carries between the confirmation and the write. */
export interface Payload {
  table: 'client_requests' | 'Properties' | 'calendar_events' | 'deals' | 'offers'
  /** Row to update; absent for an insert. */
  id?: number | string
  columns: Record<string, unknown>
  extras: Record<string, unknown>
  /**
   * Which column holds the JSON blob for this table, when it has one.
   * calendar_events has no blob — writing "{}" into a plain text column is not
   * the same as leaving it alone.
   */
  blobColumn?: 'notes' | 'Amenities'
  /** Free-text note to append to the client's log (feedback flow). */
  logEntry?: string
  label: string
}

export async function stage(
  admin: SupabaseClient,
  profile: Profile,
  actionType: string,
  summary: string,
  payload: Payload,
): Promise<string> {
  // One live action per agent: a stale half-finished edit must never be the
  // thing a later "yes" applies.
  await admin.from('pending_actions').delete().eq('profile_id', profile.id)
  const { error } = await admin.from('pending_actions').insert({
    company_id: profile.company_id,
    profile_id: profile.id,
    action_type: actionType,
    summary,
    payload,
  })
  if (error) {
    console.error('[whatsapp] could not stage action', error)
    return 'I could not prepare that change. Please try again.'
  }
  return summary
}

// ── Resolving the client an agent named ─────────────────────────────────────

type Resolved =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; message: string }

export async function resolveClient(admin: SupabaseClient, profile: Profile, name: string | undefined): Promise<Resolved> {
  const ref = splitClientRef(name)
  if (!ref.name) return { ok: false, message: 'Which client? Try "update Ahmed\'s budget to 400k".' }

  let q = admin
    .from('client_requests')
    .select('*')
    .eq('company_id', profile.company_id)
    .ilike('Client Name', `%${ref.name}%`)
    .limit(6)
  // An area qualifier ("… in Beit Mery") disambiguates same-named clients.
  if (ref.location) q = q.ilike('prefered-location', `%${ref.location}%`)

  const { data } = await q
  const rows = data ?? []
  if (!rows.length) return { ok: false, message: `No client matching "${ref.name}"${ref.location ? ` in ${ref.location}` : ''}.` }
  if (rows.length > 1) {
    // Masked names for the same reason as above (no enumerating other agents'
    // clients), but each carries its area so identical names can be told apart
    // and the agent knows how to pick one.
    const lines = rows.map(r => `• ${clientLabel(profile, r)} — ${(r['prefered-location'] as string) || 'no area set'}`)
    const egArea = (rows[0]['prefered-location'] as string) || 'Beirut'
    return {
      ok: false,
      message: `${rows.length} clients match "${ref.name}":\n${lines.join('\n')}\n\nAdd the area to pick one, e.g. "${ref.name} in ${egArea}".`,
    }
  }
  return { ok: true, row: rows[0] }
}

// ── "update Ahmed's budget to 400k" ─────────────────────────────────────────

export async function stageClientUpdate(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const found = await resolveClient(admin, profile, intent.clientName)
  if (!found.ok) return found.message

  const row = found.row
  if (!canEditClient(toSession(profile), agentOf(row, 'notes'))) {
    return `${clientLabel(profile, row)} belongs to another agent, so I can't change that record.`
  }

  const update = buildUpdate(intent.fields, CLIENT_FIELDS)
  if (!hasChanges(update)) {
    const bad = update.rejected.length ? ` I can't set: ${update.rejected.join(', ')}.` : ''
    return `I didn't catch what to change.${bad}\n\nTry "set Ahmed's budget to 400k" or "mark Ahmed as closed".`
  }

  const summary = confirmationText(row['Client Name'] as string, update.changes, update.rejected)
  return stage(admin, profile, 'update_client', summary, {
    table: 'client_requests',
    id: Number(row.id),
    columns: update.columns,
    extras: update.extras,
    blobColumn: 'notes',
    label: row['Client Name'] as string,
  })
}

// ── "mark property #23 as sold" ─────────────────────────────────────────────

export async function stagePropertyUpdate(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  if (!intent.propertyId) return 'Which listing? Include its number, e.g. "mark property #23 as sold".'

  const { data: row } = await admin
    .from('Properties')
    .select('*')
    .eq('company_id', profile.company_id)
    .eq('id', intent.propertyId)
    .maybeSingle()

  if (!row) return `No listing with id #${intent.propertyId}.`

  if (!canEditProperty(toSession(profile), agentOf(row, 'Amenities'))) {
    return `#${intent.propertyId} was listed by another agent, so I can't change it.`
  }

  const update = buildUpdate(intent.fields, PROPERTY_FIELDS)
  if (!hasChanges(update)) {
    const bad = update.rejected.length ? ` I can't set: ${update.rejected.join(', ')}.` : ''
    return `I didn't catch what to change on #${intent.propertyId}.${bad}\n\nTry "mark property #23 as sold" or "set property #23 price to 520k".`
  }

  const summary = confirmationText(`#${row.id} ${row.Title}`, update.changes, update.rejected)
  return stage(admin, profile, 'update_property', summary, {
    table: 'Properties',
    id: Number(row.id),
    columns: update.columns,
    extras: update.extras,
    blobColumn: 'Amenities',
    label: `#${row.id} ${row.Title}`,
  })
}

// ── "write a description for #23" ────────────────────────────────────────────
// Generates a listing description using the company's saved template (if any),
// shows it, and stages a confirm-save onto the listing's Amenities.aiDescription
// — the same field the web generator writes and the public page renders.
export async function stageDescribeProperty(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  if (!intent.propertyId) return 'Which listing? Try "write a description for #23".'

  const { data: row } = await admin
    .from('Properties')
    .select('*')
    .eq('company_id', profile.company_id)
    .eq('id', intent.propertyId)
    .maybeSingle()

  if (!row) return `No listing with id #${intent.propertyId}.`
  if (!canEditProperty(toSession(profile), agentOf(row, 'Amenities'))) {
    return `#${intent.propertyId} was listed by another agent, so I can't change it.`
  }

  // The company's shared template (null → free-form marketing copy).
  const { data: company } = await admin
    .from('Companies').select('description_template').eq('id', profile.company_id).maybeSingle()
  const template = (company?.description_template as string | null) ?? null

  const p = dbRowToProperty(row, 0)
  const input: DescriptionInput = {
    title: p.title, type: p.type, transaction: p.transaction, price: p.price, rent: p.rent,
    district: p.district, city: p.city, size: p.size, beds: p.beds, baths: p.baths,
    garden: p.garden, balcony: p.balcony, view: p.view, parkings: p.parkings, buildingAge: p.buildingAge,
  }

  let text: string
  try {
    // No retry and a hard deadline — Twilio abandons the webhook at 15 seconds.
    text = await generateDescription(input, template, { retry: false, deadlineMs: 12_000 })
  } catch {
    return 'That took too long to generate — please try again in a moment.'
  }
  if (!text) return "I couldn't generate a description just now. Please try again."

  const label = p.title || `#${p.id}`
  const summary = [
    `Here's a description for ${label}${template ? ' (using your saved template)' : ''}:`,
    '',
    text,
    '',
    'Reply YES to save it to the listing, or NO to discard.',
  ].join('\n')

  return stage(admin, profile, 'describe_property', summary, {
    table: 'Properties',
    id: p.id,
    columns: {},
    extras: { aiDescription: text },
    blobColumn: 'Amenities',
    label,
  })
}

// ── "add a listing: 3 bed in Hamra, 450k" ───────────────────────────────────

export async function stageCreateProperty(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const built = buildNewProperty(intent.fields)
  if (built.missing.length) {
    return [
      `I need a bit more to create the listing — missing: ${built.missing.join(', ')}.`,
      '',
      'Try: "add listing: 3 bed apartment in Hamra, Beirut, 450k, 180 sqm".',
    ].join('\n')
  }

  // Ownership is stamped at creation so the listing belongs to whoever added it.
  // Managers have no agent_code; the key is left off rather than written as null,
  // which would read as "owned by nobody" instead of "not agent-owned".
  const extras = { ...built.extras }
  if (profile.agent_code) extras.agentId = profile.agent_code

  const summary = confirmationText('a new listing', built.changes)
  return stage(admin, profile, 'create_property', summary, {
    table: 'Properties',
    columns: { ...built.columns, company_id: profile.company_id },
    extras,
    blobColumn: 'Amenities',
    label: String(built.columns.Title ?? 'new listing'),
  })
}

// ── "spoke to Ahmed, he wants to see it Saturday" ───────────────────────────

export async function stageFeedback(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
  rawMessage: string,
): Promise<string> {
  const found = await resolveClient(admin, profile, intent.clientName)
  if (!found.ok) return found.message

  const row = found.row
  if (!canEditClient(toSession(profile), agentOf(row, 'notes'))) {
    return `${clientLabel(profile, row)} belongs to another agent, so I can't add notes to that record.`
  }

  const note = intent.notes || rawMessage
  const update = buildUpdate(intent.fields, CLIENT_FIELDS)   // e.g. "not interested" -> status

  const changes = [`Note: "${note.slice(0, 200)}"`, ...update.changes]
  const summary = confirmationText(row['Client Name'] as string, changes, update.rejected)

  return stage(admin, profile, 'feedback', summary, {
    table: 'client_requests',
    id: Number(row.id),
    columns: update.columns,
    extras: update.extras,
    blobColumn: 'notes',
    logEntry: note,
    label: row['Client Name'] as string,
  })
}

// ── Reminder replies (Phase 4) ──────────────────────────────────────────────

/** How long after sending a reminder a bare "done" still refers to it. */
const REMINDER_REPLY_WINDOW_DAYS = 3

/**
 * Apply "done" / "snooze 3d" / "not interested" to the most recent reminder.
 * Returns null when there is no outstanding reminder, so the caller falls back
 * to normal intent classification rather than guessing what "done" meant.
 */
export async function handleReminderReply(
  admin: SupabaseClient,
  profile: Profile,
  action: ReminderAction,
  snoozeDays: number | undefined,
  rawMessage = '',
): Promise<string | null> {
  const cutoff = new Date(Date.now() - REMINDER_REPLY_WINDOW_DAYS * 86_400_000).toISOString()

  const { data: reminder } = await admin
    .from('reminder_schedule')
    .select('id, client_id, sent_at')
    .eq('profile_id', profile.id)
    .eq('status', 'sent')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reminder) return null

  const { data: row } = await admin
    .from('client_requests')
    .select('*')
    .eq('id', reminder.client_id)
    .maybeSingle()

  if (!row) return null

  const outcome = reminderOutcome(action, row['Client Name'] as string, snoozeDays, new Date(), rawMessage)
  if (!outcome) return null

  // Permission is still checked: a reminder is not a licence to edit a record
  // the agent has since lost access to.
  if (!canEditClient(toSession(profile), agentOf(row, 'notes'))) return null

  const update: Record<string, unknown> = {
    notes: appendLog(row.notes, outcome.logEntry),
  }
  if (outcome.clientStatus) update.status = outcome.clientStatus

  const { error: clientErr } = await admin.from('client_requests').update(update).eq('id', row.id)
  if (clientErr) {
    console.error('[whatsapp] reminder client update failed', clientErr)
    return 'I could not update that record. Please try again.'
  }

  const reminderUpdate: Record<string, unknown> = { status: outcome.status }
  if (outcome.dueDate) {
    // A snooze becomes the next pending reminder rather than staying 'sent',
    // otherwise it would never fire again.
    reminderUpdate.status = 'pending'
    reminderUpdate.due_date = outcome.dueDate
  }
  await admin.from('reminder_schedule').update(reminderUpdate).eq('id', reminder.id)

  return outcome.reply
}

// ── Applying, after "YES" ───────────────────────────────────────────────────

export async function applyPendingAction(
  admin: SupabaseClient,
  profile: Profile,
  actionType: string,
  payload: unknown,
): Promise<string> {
  const p = payload as Payload
  if (!p || !p.table) return 'That request expired. Please send it again.'

  try {
    // Offers have their own logic (insert a round / settle it + advance the deal).
    if (p.table === 'offers') return await applyOfferAction(admin, profile, actionType, p)

    // Insert (new listing, or a calendar event)
    if (!p.id) {
      const insert = p.blobColumn
        ? { ...p.columns, [p.blobColumn]: JSON.stringify(p.extras) }
        : { ...p.columns }
      const { data, error } = await admin.from(p.table).insert(insert).select('*').maybeSingle()
      if (error) throw error
      if (p.table === 'calendar_events') return `Saved — "${p.label}" is on your calendar.`
      if (p.table === 'client_requests') return `Saved — ${p.label} added as a client.`

      // A listing added from WhatsApp raises the same match alerts as one added
      // from the web form.
      if (p.table === 'Properties' && data) {
        await createListingAlerts(admin, profile.company_id, data as Record<string, unknown>)
      }
      return `Saved — listing #${data?.id} created.`
    }

    // Deals: ownership is the agent_id column (not a JSON blob), so they get
    // their own permission check and a plain column update. The DB trigger keeps
    // stage_changed_at and stage_history; the lead score refreshes on the next
    // web-side recalculation (the webhook has no signed-in session to run one).
    if (p.table === 'deals') {
      const { data: deal } = await admin
        .from('deals').select('id, agent_id').eq('company_id', profile.company_id).eq('id', p.id).maybeSingle()
      if (!deal) return 'That deal no longer exists.'
      if (!isManager(profile.role) && (deal as Record<string, unknown>).agent_id !== profile.agent_code) {
        return 'You no longer have permission to move that deal.'
      }
      const stage = p.columns.stage as Stage
      const cols = { stage, outcome: stage === 'closed' ? (p.columns.outcome ?? null) : null }
      const { error } = await admin.from('deals').update(cols).eq('id', p.id).eq('company_id', profile.company_id)
      if (error) throw error
      const label = cols.outcome ? `${stageLabel('closed')} (${cols.outcome})` : stageLabel(stage)
      return `Saved — ${p.label} is now ${label}.`
    }

    // Update: re-read the row so permission is checked against current state
    // and the JSON blob is merged rather than overwritten.
    const { data: row, error: readErr } = await admin
      .from(p.table)
      .select('*')
      .eq('company_id', profile.company_id)
      .eq('id', p.id)
      .maybeSingle()
    if (readErr) throw readErr
    if (!row) return 'That record no longer exists.'

    const owner = p.blobColumn ? agentOf(row, p.blobColumn) : null
    const allowed = p.table === 'Properties'
      ? canEditProperty(toSession(profile), owner)
      : canEditClient(toSession(profile), owner)
    if (!allowed) return 'You no longer have permission to change that record.'

    const columns: Record<string, unknown> = { ...p.columns }

    // Only tables that carry a JSON blob get the merge treatment.
    const blob = p.blobColumn
    if (blob) {
      if (p.logEntry) {
        // Feedback merges the note into the same blob as any field changes.
        const withLog = appendLog(row[blob], p.logEntry)
        columns[blob] = mergeExtras(withLog, p.extras)
      } else if (Object.keys(p.extras).length) {
        columns[blob] = mergeExtras(row[blob], p.extras)
      }
    }

    const { error } = await admin.from(p.table).update(columns).eq('id', p.id)
    if (error) throw error

    if (actionType === 'describe_property') return `Saved — description added to ${p.label}.`
    return `Saved — ${p.label} updated.`
  } catch (err) {
    console.error('[whatsapp] apply failed', actionType, err)
    return 'The save failed. Nothing was changed — please try again.'
  }
}
