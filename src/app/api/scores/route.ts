import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recalculateScores } from '@/lib/score-engine'
import { getSession } from '@/lib/session'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)
const STALE_MS = 12 * 60 * 60 * 1000 // recompute at most twice a day when staleOnly

// POST /api/scores            → recalculate all clients now
// POST /api/scores?staleOnly=1 → recalculate only if scores are older than 12h
//                                (this is the nightly-decay substitute: the
//                                pipeline page pings it on load, so recency
//                                decay applies at least daily without cron)
// POST body { clientId }      → recalculate a single client
export async function POST(req: NextRequest) {
  try {
    // Recalculating is expensive — only for signed-in users.
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const staleOnly = req.nextUrl.searchParams.get('staleOnly') === '1'
    let clientId: number | undefined
    try {
      const body = await req.json()
      if (body?.clientId) clientId = Number(body.clientId)
    } catch { /* no body is fine */ }

    if (staleOnly) {
      const supabase = await createClient()
      const { data } = await supabase
        .from('client_requests')
        .select('score_updated_at')
        .eq('company_id', COMPANY_ID)
        .order('score_updated_at', { ascending: true, nullsFirst: true })
        .limit(1)
      const oldest = data?.[0]?.score_updated_at
      if (oldest && Date.now() - new Date(oldest).getTime() < STALE_MS) {
        return NextResponse.json({ updated: 0, skipped: 'fresh' })
      }
    }

    const result = await recalculateScores({ clientId, companyId: COMPANY_ID })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
