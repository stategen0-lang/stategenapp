import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { dbRowToClient, dbRowToProperty } from '@/lib/db-mappers'
import { toCsv, csvFilename, type CsvColumn } from '@/lib/csv'
import {
  CLIENT_COLUMNS, PROPERTY_COLUMNS, DEAL_COLUMNS, EVENT_COLUMNS,
  EXPORT_LABELS, isExportKind, type ExportKind,
  type DealExport, type EventExport,
} from '@/lib/export-columns'

// Company data export, manager only.
//
// Contact details are included: it is the manager's own company's data, and a
// partial export is a support ticket waiting to happen. The gate is that only a
// manager may reach the route at all — an agent gets 403, never a masked file.

type Row = Record<string, unknown>

async function rowsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: number,
  kind: ExportKind,
): Promise<{ rows: unknown[]; columns: CsvColumn<never>[] }> {
  switch (kind) {
    case 'clients': {
      const { data } = await supabase
        .from('client_requests').select('*').eq('company_id', companyId)
        .order('id', { ascending: true })
      const rows = (data ?? []).map((r, i) => dbRowToClient(r as Row, i))
      return { rows, columns: CLIENT_COLUMNS as CsvColumn<never>[] }
    }
    case 'properties': {
      const { data } = await supabase
        .from('Properties').select('*').eq('company_id', companyId)
        .order('id', { ascending: true })
      const rows = (data ?? []).map((r, i) => dbRowToProperty(r as Row, i))
      return { rows, columns: PROPERTY_COLUMNS as CsvColumn<never>[] }
    }
    case 'deals': {
      const { data } = await supabase
        .from('deals')
        .select('id,stage,outcome,value,agent_id,created_at,client_requests("Client Name",lead_score),Properties(Title,Neighborhood,Location)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true })
      const rows: DealExport[] = (data ?? []).map(r => {
        const row = r as Row
        const client = row.client_requests as Row | null
        const prop = row.Properties as Row | null
        const propLabel = prop
          ? [prop.Title, [prop.Neighborhood, prop.Location].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
          : null
        return {
          id: row.id as string,
          clientName: (client?.['Client Name'] as string) ?? 'Unknown client',
          propertyLabel: propLabel,
          stage: row.stage as string,
          outcome: (row.outcome as string) ?? null,
          value: Number(row.value) || 0,
          leadScore: Number(client?.lead_score ?? 0),
          agent_id: (row.agent_id as string) ?? null,
          created_at: row.created_at as string,
        }
      })
      return { rows, columns: DEAL_COLUMNS as CsvColumn<never>[] }
    }
    case 'events': {
      const { data } = await supabase
        .from('calendar_events')
        .select('*,client_requests("Client Name")')
        .eq('company_id', companyId)
        .order('starts_at', { ascending: true })
      // Attribute each event to its agent by name.
      const { data: people } = await supabase
        .from('Profiles').select('id, Full_name').eq('company_id', companyId)
      const nameOf = new Map((people ?? []).map(p => [p.id as string, p.Full_name as string]))
      const rows: EventExport[] = (data ?? []).map(r => {
        const row = r as Row
        const client = row.client_requests as Row | null
        return {
          id: row.id as string,
          title: row.title as string,
          kind: row.kind as string,
          starts_at: row.starts_at as string,
          ends_at: row.ends_at as string,
          all_day: !!row.all_day,
          location: (row.location as string) ?? null,
          agentName: nameOf.get(row.profile_id as string),
          clientName: (client?.['Client Name'] as string) ?? null,
        }
      })
      return { rows, columns: EVENT_COLUMNS as CsvColumn<never>[] }
    }
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The whole feature is manager-only. An agent must not be able to pull the
  // company's client contact details by hitting the URL directly.
  if (!isManager(session.role)) {
    return NextResponse.json({ error: 'Only managers can export company data.' }, { status: 403 })
  }

  const kind = req.nextUrl.searchParams.get('kind')
  if (!isExportKind(kind)) {
    return NextResponse.json({ error: 'Unknown export type.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { rows, columns } = await rowsFor(supabase, session.companyId, kind)

  const csv = toCsv(rows as never[], columns)
  const filename = csvFilename(EXPORT_LABELS[kind])

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A CSV of live company data should never be cached by a proxy.
      'Cache-Control': 'no-store',
    },
  })
}
