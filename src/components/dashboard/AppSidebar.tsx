'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Building2,
  Users,
  BarChart3,
  User,
  LogOut,
} from 'lucide-react'
import { type User as SupabaseUser } from '@supabase/supabase-js'

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/properties',  label: 'Properties', icon: Building2 },
  { href: '/clients',     label: 'Clients',    icon: Users },
  { href: '/analytics',   label: 'Reports',    icon: BarChart3 },
  { href: '/settings',    label: 'My Profile', icon: User },
]

interface AppSidebarProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
  user: SupabaseUser
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

  const displayName = profile?.Full_name ?? user.email ?? 'Agent'
  const companyName = profile?.Companies?.Name ?? 'Meridian'
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <aside className="w-60 flex flex-col shrink-0" style={{ background: '#0E1F3D' }}>
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#5E8FD6' }}>
          <Building2 className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold text-white text-base tracking-tight">Meridian</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
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
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: '#2E5288', color: '#fff' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: '#fff' }}>{displayName}</p>
            <p className="text-xs truncate" style={{ color: '#9DB2CC' }}>{companyName}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 p-1 rounded transition-colors hover:bg-white/10"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" style={{ color: '#9DB2CC' }} />
          </button>
        </div>
      </div>
    </aside>
  )
}
