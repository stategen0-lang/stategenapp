import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

// The expected unlock token, or null when ADMIN_SECRET isn't configured.
// There is deliberately NO default secret: a hardcoded fallback would let anyone
// who can read this source forge the admin_token cookie and unlock the panel, so
// a missing secret fails CLOSED (no token is issued and none validates).
function makeToken(): string | null {
  const secret = process.env.ADMIN_SECRET
  if (!secret || !secret.trim()) return null
  return createHmac('sha256', secret).update('admin-session').digest('hex')
}

// POST /api/admin/verify — verifies the admin PIN and sets an httpOnly session cookie
export async function POST(req: NextRequest) {
  const token = makeToken()
  if (!token) {
    console.error('[admin] ADMIN_SECRET is not set — refusing to issue an unlock token.')
    return NextResponse.json({ error: 'Admin unlock is not configured on the server.' }, { status: 503 })
  }
  const { pin } = await req.json().catch(() => ({ pin: '' }))
  const expected = process.env.ADMIN_PIN
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set('admin_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}

// GET /api/admin/verify — checks if the session cookie is still valid
export async function GET(req: NextRequest) {
  const expected = makeToken()
  const token = req.cookies.get('admin_token')?.value
  if (!expected || !token || token !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
