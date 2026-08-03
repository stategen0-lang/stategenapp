'use client'

import { useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Logo from '@/components/brand/Logo'

// Shown to an agent whose account exists but hasn't been approved by a manager
// yet. The dashboard layout redirects unapproved sessions here.
export default function PendingPage() {
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5' }}>
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <Logo size={34} withWordmark />
        </div>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#FBEFD6' }}>
          <Clock className="h-7 w-7" style={{ color: '#9A6516' }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Waiting for approval</h2>
        <p className="text-sm mb-6" style={{ color: '#7A8499' }}>
          Your account is set up, but a manager at your agency still needs to approve
          it before you can sign in. You&apos;ll get access as soon as they do —
          check back shortly.
        </p>
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
