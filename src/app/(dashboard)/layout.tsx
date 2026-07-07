import AppSidebar from '@/components/dashboard/AppSidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const mockUser = { id: 'demo', email: 'demo@meridian.com' } as any
  const mockProfile = { Full_name: 'Sami Abi Nader', role: 'Agent', Companies: { Name: 'Meridian Estates' } }

  return (
    <div className="flex h-screen" style={{ background: '#faf9f5' }}>
      <AppSidebar profile={mockProfile} user={mockUser} />
      {/* pt-14 = mobile top bar height, pb-16 = mobile bottom tab bar height */}
      <main className="flex-1 overflow-y-auto pt-14 pb-16 md:pt-0 md:pb-0">
        {children}
      </main>
    </div>
  )
}
