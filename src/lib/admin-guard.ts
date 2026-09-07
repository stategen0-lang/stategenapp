import { getSession } from '@/lib/session'

// Shared gate for the platform-admin ("operator") API routes under /api/admin/*.
// These use the service-role client, which bypasses RLS, so every handler MUST
// call this first — otherwise the endpoint is an open door to every company's
// data and to granting/revoking access.
//
// On failure returns { error, status }; on success returns { session }. Callers:
//   const gate = await requireAdmin()
//   if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
export async function requireAdmin() {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized', status: 401 as const }
  if (!session.isPlatformAdmin) return { error: 'Forbidden', status: 403 as const }
  return { session }
}
