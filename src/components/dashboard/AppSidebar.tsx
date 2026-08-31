'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Building2,
  Users,
  KanbanSquare,
  CalendarDays,
  Bell,
  BarChart3,
  User,
  UserCheck,
  Activity,
  MoreHorizontal,
  LogOut,
} from 'lucide-react'
import { type User as SupabaseUser } from '@supabase/supabase-js'
import Logo from '@/components/brand/Logo'

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/properties',  label: 'Properties', icon: Building2 },
  { href: '/clients',     label: 'Clients',    icon: Users },
  { href: '/pipeline',    label: 'Pipeline',   icon: KanbanSquare },
  { href: '/calendar',    label: 'Calendar',   icon: CalendarDays },
  { href: '/analytics',   label: 'Reports',    icon: BarChart3 },
  { href: '/settings',    label: 'Profile',    icon: User },
]

interface AppSidebarProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
  user: SupabaseUser | null
}

// One row in the mobile "More" sheet (Alerts / Team / Activity).
function MoreItem({ href, icon, label, badge, badgeColor, active, onNav }: {
  href: string; icon: ReactNode; label: string
  badge?: number; badgeColor?: string; active: boolean; onNav: () => void
}) {
  return (
    <Link href={href} onClick={onNav} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
      style={{ borderColor: 'rgba(255,255,255,0.07)', background: active ? 'rgba(94,143,214,0.12)' : 'transparent' }}>
      <span style={{ color: active ? '#5E8FD6' : '#9DB2CC' }}>{icon}</span>
      <span className="text-sm font-semibold flex-1" style={{ color: active ? '#DCE7F5' : '#C8D6EA' }}>{label}</span>
      {badge != null && badge > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: badgeColor ?? '#D94A4A', color: '#fff' }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  )
}

export default function AppSidebar({ profile, user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // Unseen match-alert count, for the badge. Refetched when the route changes
  // so visiting /alerts (which marks them read) clears the badge.
  const [unseenAlerts, setUnseenAlerts] = useState(0)
  useEffect(() => {
    let live = true
    fetch('/api/alerts')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d && typeof d.unseen === 'number') setUnseenAlerts(d.unseen) })
      .catch(() => {})
    return () => { live = false }
  }, [pathname])

  // Pending agent-approval count (managers only), for the badge.
  const [pendingAgents, setPendingAgents] = useState(0)
  useEffect(() => {
    if (profile?.role !== 'owner' && profile?.role !== 'manager') return
    let live = true
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d && Array.isArray(d.pending)) setPendingAgents(d.pending.length) })
      .catch(() => {})
    return () => { live = false }
  }, [pathname, profile?.role])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const displayName = profile?.Full_name ?? user?.email ?? 'Agent'
  const isMgr = profile?.role === 'owner' || profile?.role === 'manager'
  const [moreOpen, setMoreOpen] = useState(false)
  const companyName = isMgr ? 'Manager · StateGen' : (profile?.Companies?.Name ?? 'StateGen')
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

  function isActive(href: string) {
    return pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
  }

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 flex-col shrink-0" style={{ background: '#0E1F3D' }}>
        {/* Logo */}
        <div className="px-5 py-5 flex items-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Logo variant="white" size={30} withWordmark priority />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: active ? 'rgba(94,143,214,0.16)' : 'transparent',
                  color: active ? '#ffffff' : '#9DB2CC',
                  borderLeft: active ? '2px solid #5E8FD6' : '2px solid transparent',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            )
          })}

          {/* Alerts — kept out of navItems so it doesn't crowd the mobile tab
              bar; carries the unseen badge. */}
          <Link
            href="/alerts"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: isActive('/alerts') ? 'rgba(94,143,214,0.16)' : 'transparent',
              color: isActive('/alerts') ? '#ffffff' : '#9DB2CC',
              borderLeft: isActive('/alerts') ? '2px solid #5E8FD6' : '2px solid transparent',
            }}
          >
            <Bell className="h-4 w-4 shrink-0" />
            <span className="flex-1">Alerts</span>
            {unseenAlerts > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#D94A4A', color: '#fff' }}>
                {unseenAlerts > 99 ? '99+' : unseenAlerts}
              </span>
            )}
          </Link>

          {/* Approvals — managers only; carries the pending-agent badge. */}
          {isMgr && (
            <Link
              href="/approvals"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: isActive('/approvals') ? 'rgba(94,143,214,0.16)' : 'transparent',
                color: isActive('/approvals') ? '#ffffff' : '#9DB2CC',
                borderLeft: isActive('/approvals') ? '2px solid #5E8FD6' : '2px solid transparent',
              }}
            >
              <UserCheck className="h-4 w-4 shrink-0" />
              <span className="flex-1">Team</span>
              {pendingAgents > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#E08A1E', color: '#fff' }}>
                  {pendingAgents > 99 ? '99+' : pendingAgents}
                </span>
              )}
            </Link>
          )}

          {/* Activity feed — managers see the whole agency's recent actions. */}
          {isMgr && (
            <Link
              href="/activity"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: isActive('/activity') ? 'rgba(94,143,214,0.16)' : 'transparent',
                color: isActive('/activity') ? '#ffffff' : '#9DB2CC',
                borderLeft: isActive('/activity') ? '2px solid #5E8FD6' : '2px solid transparent',
              }}
            >
              <Activity className="h-4 w-4 shrink-0" />
              <span className="flex-1">Activity</span>
            </Link>
          )}
        </nav>

        {/* Profile */}
        <div className="px-3 pb-4 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#2E5288', color: '#fff' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: '#fff' }}>{displayName}</p>
              <p className="text-xs truncate" style={{ color: '#9DB2CC' }}>{companyName}</p>
            </div>
            <button onClick={handleSignOut} className="shrink-0 p-1 rounded transition-colors hover:bg-white/10" title="Sign out">
              <LogOut className="h-4 w-4" style={{ color: '#9DB2CC' }} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3" style={{ background: '#0E1F3D', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Logo variant="white" size={26} withWordmark priority />
        <div className="flex items-center gap-2">
          {/* "More" — houses the secondary sections (Alerts, Team, Activity) so
              the bottom tab bar and top bar never get crowded on mobile. */}
          <div className="relative">
            <button onClick={() => setMoreOpen(o => !o)} className="relative p-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)' }} aria-label="More">
              <MoreHorizontal className="h-4 w-4" style={{ color: '#9DB2CC' }} />
              {unseenAlerts + pendingAgents > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: '#D94A4A', color: '#fff' }}>
                  {unseenAlerts + pendingAgents > 9 ? '9+' : unseenAlerts + pendingAgents}
                </span>
              )}
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 mt-2 w-48 rounded-xl overflow-hidden z-50" style={{ background: '#13294D', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
                  <MoreItem href="/alerts" icon={<Bell className="h-4 w-4" />} label="Alerts" badge={unseenAlerts} badgeColor="#D94A4A" active={isActive('/alerts')} onNav={() => setMoreOpen(false)} />
                  {isMgr && <MoreItem href="/approvals" icon={<UserCheck className="h-4 w-4" />} label="Team" badge={pendingAgents} badgeColor="#E08A1E" active={isActive('/approvals')} onNav={() => setMoreOpen(false)} />}
                  {isMgr && <MoreItem href="/activity" icon={<Activity className="h-4 w-4" />} label="Activity" active={isActive('/activity')} onNav={() => setMoreOpen(false)} />}
                </div>
              </>
            )}
          </div>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: '#2E5288', color: '#fff' }}>
            {initials}
          </div>
          <button onClick={handleSignOut} className="p-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <LogOut className="h-3.5 w-3.5" style={{ color: '#9DB2CC' }} />
          </button>
        </div>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex" style={{ background: '#0E1F3D', borderTop: '1px solid rgba(255,255,255,0.10)' }}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5"
              style={{ color: active ? '#5E8FD6' : '#9DB2CC' }}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
