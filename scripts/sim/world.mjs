// One agency, read once from production, then copied fresh into memory for
// every conversation — so what one conversation saves can never leak into the
// next, and nothing is ever written back.

import { createClient } from '@supabase/supabase-js'
import { fakeDb } from '../../src/lib/whatsapp/fake-db.mjs'

// Company-scoped tables the bot reads. The conversation's own state
// (whatsapp_logs, pending_actions, conversation_state) starts empty.
const SCOPED = ['Profiles', 'Properties', 'client_requests', 'deals', 'offers', 'calendar_events', 'company_areas', 'listing_alerts', 'property_history', 'reminder_schedule']

// PostgREST embeds the bot uses ("deals(client_requests(…))"), by foreign key.
const LINKS = {
  'listing_alerts.Properties': 'property_id',
  'listing_alerts.client_requests': 'client_id',
  'deals.client_requests': 'client_id',
  'deals.Properties': 'property_id',
  'offers.deals': 'deal_id',
  'stage_history.deals': 'deal_id',
  'property_history.Properties': 'property_id',
  'calendar_events.Properties': 'property_id',
}

/** Read-only. Must run BEFORE lockdown(), which removes the credentials. */
export async function loadSnapshot(companyId) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase URL / service key missing from the environment.')
  const live = createClient(url, key, { auth: { persistSession: false } })
  const read = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data ?? [] }

  const tables = {}
  tables.Companies = await read(live.from('Companies').select('*').eq('id', companyId))
  if (!tables.Companies.length) throw new Error(`No company ${companyId}.`)
  for (const t of SCOPED) tables[t] = await read(live.from(t).select('*').eq('company_id', companyId))
  const dealIds = tables.deals.map(d => d.id)
  tables.stage_history = dealIds.length ? await read(live.from('stage_history').select('*').in('deal_id', dealIds)) : []
  return tables
}

/** A private, writable copy for one conversation. */
export function freshDb(snapshot) {
  return fakeDb({
    ...structuredClone(snapshot),
    whatsapp_logs: [], pending_actions: [], conversation_state: [], push_subscriptions: [],
  }, {
    links: LINKS,
    // What the real columns default to — without expires_at every waiting
    // change looks expired and "yes" finds nothing to save.
    defaults: {
      pending_actions: () => ({ created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }),
      '*': () => ({ created_at: new Date().toISOString() }),
    },
  })
}
