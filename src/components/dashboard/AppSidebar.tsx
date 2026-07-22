'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Building2,
  Users,
  KanbanSquare,
  CalendarDays,
  BarChart3,
  User,
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

export default function AppSidebar({ profile, user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const displayName = profile?.Full_name ?? user?.email ?? 'Agent'
  const isMgr = profile?.role === 'owner' || profile?.role === 'manager'
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
