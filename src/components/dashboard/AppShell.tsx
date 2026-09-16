'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppSidebar from '@/components/dashboard/AppSidebar'
import SwipeNav from '@/components/dashboard/SwipeNav'
import { useSession } from '@/hooks/use-session'
import { companyHasAccess } from '@/lib/billing'

// The dashboard frame.
//
// It holds no data of its own, so the layout around it renders as a static page
// served from the CDN (~100ms from Paris) instead of being built per request in
// Mumbai (~400ms+, after three database round-trips). Who you are arrives from
// /api/me — cached on the device, so the sidebar shows your name immediately.
//
// The two gates the layout used to enforce (expired agency → /renew, unapproved
// agent → /pending) run here as soon as the session is known. They are UX, not
// security: the data routes refuse an expired agency and every route checks the
// session server-side (see companyAccessBlocked in lib/session).

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, unauthenticated } = useSession()
  const router = useRouter()

  useEffect(() => {
    // The proxy may let a request through on a cookie that turns out to be stale
    // (see lib/proxy-session). When the server actually says 401, sign out for
    // real — but never on a failed request, which is just being offline.
    if (unauthenticated) { router.replace('/login'); return }
    if (loading || !session || session.isPlatformAdmin) return
    if (!companyHasAccess(session.companyAccessStatus, session.companyAccessUntil)) {
      router.replace('/renew')
      return
    }
    if (!session.approved) router.replace('/pending')
  }, [loading, session, unauthenticated, router])

  const profile = {
    Full_name: session?.fullName ?? session?.email ?? 'Agent',
    role: session?.role ?? 'agent',
    agent_code: session?.agentCode ?? null,
    Companies: { Name: 'StateGen' },
  }

  return (
    <div className="flex h-screen" style={{ background: '#faf9f5' }}>
      <SwipeNav />
      <AppSidebar profile={profile} user={null} />
      {/* pt-14 = mobile top bar height, pb-16 = mobile bottom tab bar height */}
      <main className="flex-1 overflow-y-auto pt-14 pb-16 md:pt-0 md:pb-0">
        {children}
      </main>
    </div>
  )
}
