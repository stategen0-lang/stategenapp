import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

// Who am I? Used by the UI to decide what to render (agent filter, edit
// buttons, masked fields). The server still enforces every rule independently.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ session: null }, { status: 401 })
  return NextResponse.json({ session })
}
