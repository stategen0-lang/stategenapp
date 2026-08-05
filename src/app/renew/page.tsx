'use client'

import { useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import { accessMessage } from '@/lib/billing'
import Logo from '@/components/brand/Logo'

const CONTACT = 'stategen0@gmail.com'

// Shown to a company whose manually-billed access is pending, expired, or
// suspended. The dashboard layout redirects here; StateGen operators bypass it.
export default function RenewPage() {
  const router = useRouter()
  const supabase = createClient()
  const { session } = useSession()
  const manager = isManager(session?.role)

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-8"><Logo size={34} withWordmark /></div>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#FBEFD6' }}>
          <Clock className="h-7 w-7" style={{ color: '#9A6516' }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>
          {session?.companyAccessStatus === 'expired' ? 'Subscription ended' : 'Account not active yet'}
        </h2>
        <p className="text-sm mb-6" style={{ color: '#7A8499' }}>
          {accessMessage(session?.companyAccessStatus)}
        </p>

        <div className="rounded-2xl p-5 text-left mb-6" style={{ background: '#fff', border: '1px solid #EEF0F4' }}>
          {manager ? (
            <>
              <p className="text-sm font-semibold mb-1" style={{ color: '#1A2B4A' }}>To activate or renew</p>
              <p className="text-xs" style={{ color: '#7A8499' }}>
                Contact StateGen to arrange payment (bank transfer or cash). Once we confirm it,
                your access is switched on right away.
              </p>
              <a href={`mailto:${CONTACT}`} className="inline-block mt-3 text-sm font-semibold" style={{ color: '#5E8FD6' }}>{CONTACT}</a>
            </>
          ) : (
            <p className="text-xs" style={{ color: '#7A8499' }}>
              Your agency&apos;s subscription isn&apos;t active. Please ask your manager to activate it.
            </p>
          )}
        </div>

        <button
          onClick={signOut}
          className="w-full py-3 rounded-xl text-sm font-semibold"
          style={{ border: '1.5px solid #D7DCE5', color: '#1A2B4A', background: '#fff' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
