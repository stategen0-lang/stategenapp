import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

function makeToken() {
  const secret = process.env.ADMIN_SECRET ?? 'fallback-change-me'
  return createHmac('sha256', secret).update('admin-session').digest('hex')
}

// POST /api/admin/verify — verifies the admin PIN and sets an httpOnly session cookie
export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({ pin: '' }))
  const expected = process.env.ADMIN_PIN
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
  }
  const token = makeToken()
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
  const token = req.cookies.get('admin_token')?.value
  if (!token || token !== makeToken()) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
