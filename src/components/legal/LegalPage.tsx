import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import Logo from '@/components/brand/Logo'

// Shared shell for the Terms and Privacy pages: brand header, title, last-updated
// line, and a readable prose column.
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ background: '#faf9f5' }}>
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <Logo size={30} withWordmark />
          <Link href="/login" className="flex items-center gap-1 text-sm font-semibold" style={{ color: '#5E8FD6' }}>
            <ChevronLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>

        <h1 className="text-3xl font-bold" style={{ color: '#1A2B4A', letterSpacing: '-0.4px' }}>{title}</h1>
        <p className="text-sm mt-1.5 mb-8" style={{ color: '#7A8499' }}>Last updated: {updated}</p>

        <div className="legal-prose space-y-5" style={{ color: '#3A4457', fontSize: '0.95rem', lineHeight: 1.7 }}>
          {children}
        </div>

        <div className="mt-10 pt-6 flex items-center gap-4 text-sm" style={{ borderTop: '1px solid #E6E3DA' }}>
          <Link href="/terms" style={{ color: '#5E8FD6' }}>Terms of Service</Link>
          <Link href="/privacy" style={{ color: '#5E8FD6' }}>Privacy Policy</Link>
          <span style={{ color: '#9AA3B2' }}>© {new Date().getFullYear()} StateGen</span>
        </div>
      </div>
    </div>
  )
}

// Small helpers so the two documents read consistently.
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold pt-3" style={{ color: '#1A2B4A' }}>{children}</h2>
}
export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5">{children}</ul>
}
