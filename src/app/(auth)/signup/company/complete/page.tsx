'use client'

import { Building2, Clock } from 'lucide-react'
import Link from 'next/link'

export default function CompanyCompletePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#faf9f5', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: '#EAF0FA' }}>
          <Clock className="h-7 w-7" style={{ color: '#2E5288' }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: '#1A2B4A' }}>Account created!</h2>
        <p className="text-sm mb-2" style={{ color: '#7A8499' }}>
          Your company is registered. We will review your account and activate it once we confirm your subscription.
        </p>
        <p className="text-sm mb-8" style={{ color: '#7A8499' }}>
          You will be able to log in as soon as your account is activated. This usually happens within 24 hours.
        </p>
        <div className="rounded-xl p-4 mb-6 text-left" style={{ background: '#F0F4FA', border: '1px solid #D8E2F0' }}>
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 shrink-0" style={{ color: '#2E5288' }} />
            <p className="text-xs" style={{ color: '#2E5288' }}>
              Contact us to confirm your payment and speed up activation.
            </p>
          </div>
        </div>
        <Link href="/login" className="block w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: '#0E1F3D' }}>
          Go to Login →
        </Link>
      </div>
    </div>
  )
}
