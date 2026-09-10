import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

// Validates the /admin unlock cookie. NOTE: nothing imports this today — the
// real gate on /api/admin/* is requireAdmin() (platform-admin email session);
// this is the optional second lock behind the PIN screen.
//
// There is deliberately NO default secret. A hardcoded fallback would let anyone
// who can read this source forge the admin_token cookie, so a missing
// ADMIN_SECRET fails CLOSED rather than accepting a guessable token.
export function checkAdminAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_SECRET
  if (!secret || !secret.trim()) {
    console.error('[admin] ADMIN_SECRET is not set — admin unlock refused.')
    return NextResponse.json({ error: 'Admin access is not configured.' }, { status: 503 })
  }
  const expected = createHmac('sha256', secret).update('admin-session').digest('hex')
  const token = req.cookies.get('admin_token')?.value
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
