import AppSidebar from '@/components/dashboard/AppSidebar'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Real signed-in identity (role + agent code) instead of the old mock user.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const session = await getSession()

  const profile = {
    Full_name: session?.fullName ?? user?.email ?? 'Agent',
    role: session?.role ?? 'agent',
    agent_code: session?.agentCode ?? null,
    Companies: { Name: 'StateGen' },
  }

  return (
    <div className="flex h-screen" style={{ background: '#faf9f5' }}>
      <AppSidebar profile={profile} user={user} />
      {/* pt-14 = mobile top bar height, pb-16 = mobile bottom tab bar height */}
      <main className="flex-1 overflow-y-auto pt-14 pb-16 md:pt-0 md:pb-0">
        {children}
      </main>
    </div>
  )
}
