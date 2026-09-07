import { NextResponse } from 'next/server'
import { getSession, getCompanyAccess } from '@/lib/session'

// Who am I? Used by the UI to decide what to render (agent filter, edit
// buttons, masked fields). The server still enforces every rule independently.
//
// getSession no longer fetches company billing access (that would cost a DB
// round-trip on every request); this endpoint adds it back for the client,
// because the /renew screen shows the access status. This route is called rarely
// (once per client mount), so the extra query here is cheap.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ session: null }, { status: 401 })
  const access = await getCompanyAccess(session.companyId)
  return NextResponse.json({
    session: { ...session, companyAccessStatus: access.status, companyAccessUntil: access.until },
  })
}
