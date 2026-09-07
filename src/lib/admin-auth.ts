import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export function checkAdminAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_SECRET ?? 'fallback-change-me'
  const expected = createHmac('sha256', secret).update('admin-session').digest('hex')
  const token = req.cookies.get('admin_token')?.value
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
