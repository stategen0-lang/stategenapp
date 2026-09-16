import AppShell from '@/components/dashboard/AppShell'

// No per-request work here on purpose: this layout is the same frame for every
// agent, so it prerenders once and is served from the CDN near the user. It used
// to await three round-trips (auth, profile, company access) before a single
// byte reached Lebanon — ~200ms+ of the wait before the app even started.
//
// What replaced each of them:
//   • signed in?        — the proxy redirects an unauthenticated request before
//                         this page is ever served (src/proxy.ts)
//   • agency access     — enforced on the data routes (companyAccessBlocked);
//                         AppShell also redirects to /renew for the UI
//   • agent approved    — AppShell redirects to /pending
//
// Nothing user-specific may be rendered here: this HTML is cached and shared.

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
