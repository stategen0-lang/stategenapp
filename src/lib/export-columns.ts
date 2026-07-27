// Column specs for the manager CSV exports.
//
// Kept separate from the API route so they can be unit-tested against known
// records, and built on the app's own types (Property, Client) rather than raw
// DB rows, so an export column means the same thing a screen column does.

import type { CsvColumn } from '@/lib/csv'
import type { Property, Client } from '@/lib/data'

const yesNo = (b: unknown) => (b ? 'Yes' : 'No')

// ── Clients ─────────────────────────────────────────────────────────────────
// Includes contact details: this is the manager's own company data, and the
// whole point of an export is to have it in full. The API gates the route to
// managers so an agent never reaches it.
export const CLIENT_COLUMNS: CsvColumn<Client>[] = [
  { header: 'ID',            value: c => c.id },
  { header: 'Name',          value: c => c.name },
  { header: 'Type',          value: c => c.type },
  { header: 'Phone',         value: c => c.phone },
  { header: 'Email',         value: c => c.email },
  { header: 'Status',        value: c => c.status },
  { header: 'Budget (USD)',  value: c => c.budget || '' },
  { header: 'Wants',         value: c => c.req.location },
  { header: 'Property Type', value: c => c.req.type },
  { header: 'Bedrooms',      value: c => c.req.beds || '' },
  { header: 'Transaction',   value: c => c.req.transaction },
  { header: 'Lead Score',    value: c => c.leadScore ?? '' },
  { header: 'Agent Rating',  value: c => c.agentRating ?? '' },
  { header: 'Agent',         value: c => c.agentId ?? '' },
]

// ── Properties ──────────────────────────────────────────────────────────────
export const PROPERTY_COLUMNS: CsvColumn<Property>[] = [
  { header: 'ID',           value: p => p.id },
  { header: 'Title',        value: p => p.title },
  { header: 'Type',         value: p => p.type },
  { header: 'Transaction',  value: p => p.transaction },
  { header: 'Price (USD)',  value: p => p.price || '' },
  { header: 'Rent /mo (USD)', value: p => p.rent || '' },
  { header: 'City',         value: p => p.city },
  { header: 'Neighbourhood', value: p => p.district },
  { header: 'Size (m²)',    value: p => p.size || '' },
  { header: 'Bedrooms',     value: p => p.beds || '' },
  { header: 'Bathrooms',    value: p => p.baths || '' },
  { header: 'Garden',       value: p => yesNo(p.garden) },
  { header: 'Balcony',      value: p => yesNo(p.balcony) },
  { header: 'View',         value: p => p.view ?? '' },
  { header: 'Status',       value: p => p.status },
  { header: 'Agent',        value: p => p.agentId ?? '' },
]

// ── Deals (pipeline) ────────────────────────────────────────────────────────
export interface DealExport {
  id: string | number
  clientName: string
  propertyLabel: string | null
  stage: string
  outcome: string | null
  value: number
  leadScore: number
  agent_id: string | null
  created_at: string
}

export const DEAL_COLUMNS: CsvColumn<DealExport>[] = [
  { header: 'ID',         value: d => d.id },
  { header: 'Client',     value: d => d.clientName },
  { header: 'Property',   value: d => d.propertyLabel ?? '' },
  { header: 'Stage',      value: d => d.stage },
  { header: 'Outcome',    value: d => d.outcome ?? '' },
  { header: 'Value (USD)', value: d => d.value || '' },
  { header: 'Lead Score', value: d => d.leadScore ?? '' },
  { header: 'Agent',      value: d => d.agent_id ?? '' },
  { header: 'Created',    value: d => (d.created_at ? d.created_at.slice(0, 10) : '') },
]

// ── Calendar events ─────────────────────────────────────────────────────────
export interface EventExport {
  id: string
  title: string
  kind: string
  starts_at: string
  ends_at: string
  all_day: boolean
  location: string | null
  agentName?: string
  clientName?: string | null
}

export const EVENT_COLUMNS: CsvColumn<EventExport>[] = [
  { header: 'Title',    value: e => e.title },
  { header: 'Type',     value: e => e.kind },
  { header: 'Starts',   value: e => e.starts_at },
  { header: 'Ends',     value: e => e.ends_at },
  { header: 'All Day',  value: e => yesNo(e.all_day) },
  { header: 'Location', value: e => e.location ?? '' },
  { header: 'Client',   value: e => e.clientName ?? '' },
  { header: 'Agent',    value: e => e.agentName ?? '' },
]

/** Everything the manager can export, for the UI to enumerate. */
export const EXPORTS = ['clients', 'properties', 'deals', 'events'] as const
export type ExportKind = (typeof EXPORTS)[number]

export const EXPORT_LABELS: Record<ExportKind, string> = {
  clients: 'Clients',
  properties: 'Properties',
  deals: 'Pipeline deals',
  events: 'Calendar events',
}

// Re-exported so a caller can validate a URL param against the same list.
export function isExportKind(v: unknown): v is ExportKind {
  return typeof v === 'string' && (EXPORTS as readonly string[]).includes(v)
}
