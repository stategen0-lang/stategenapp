import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { fetchDealOfferSummary } from '@/lib/offers-server'

// Current offer per deal (amount + status) for the pipeline badges. Loaded
// separately from /api/deals so the board never blocks on it. Fails soft to an
// empty map if the offers table isn't there yet.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const admin = createAdminClient()
    const summary = await fetchDealOfferSummary(admin, session.companyId)
    return NextResponse.json({ summary })
  } catch {
    return NextResponse.json({ summary: {} })
  }
}
