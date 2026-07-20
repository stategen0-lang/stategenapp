'use client'

import Link from 'next/link'
import { Shield, Users } from 'lucide-react'
import Logo from '@/components/brand/Logo'

export default function SignupLandingPage() {
  return (
    <div className="min-h-screen flex" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12" style={{ background: '#0E1F3D' }}>
        <Logo variant="white" size={34} withWordmark priority />
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4" style={{ letterSpacing: '-0.3px' }}>
            Set up your agency<br />on StateGen.
          </h1>
          <p className="text-base mb-10" style={{ color: '#9DB2CC' }}>
            Register your company once as a manager, then invite<br />
            your agents to join under your company domain.
          </p>
          <div className="space-y-3">
            {[
              'Manager registers the company',
              'Agents sign up under the company domain',
              'Manager approves each agent before they log in',
            ].map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#5E8FD6', color: '#fff' }}>
                  {i + 1}
                </div>
                <span className="text-sm" style={{ color: '#C8D6EA' }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: '#6A7A94' }}>© 2026 StateGen · Agent Portal</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12" style={{ background: '#faf9f5' }}>
        <div className="w-full max-w-sm">
          <p className="text-xs font-bold tracking-widest mb-2 uppercase" style={{ color: '#6A7488', letterSpacing: '0.5px' }}>
            Get started
          </p>
          <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1A2B4A', letterSpacing: '-0.3px' }}>
            Who are you?
          </h2>
          <p className="text-sm mb-8" style={{ color: '#7A8499' }}>
            Choose the account type that matches your role.
          </p>

          <div className="space-y-3">
            {/* Manager card */}
            <Link
              href="/signup/company"
              className="flex items-start gap-4 p-5 rounded-2xl bg-white border-2 border-transparent transition-all hover:border-blue-500 group"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '2px solid #EEF0F4' }}
              onMouseEnter={e => (e.currentTarget.style.border = '2px solid #5E8FD6')}
              onMouseLeave={e => (e.currentTarget.style.border = '2px solid #EEF0F4')}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
                <Shield className="h-5 w-5" style={{ color: '#2E5288' }} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-0.5" style={{ color: '#1A2B4A' }}>I&apos;m a Manager</p>
                <p className="text-xs leading-relaxed" style={{ color: '#7A8499' }}>
                  Register a new company on StateGen. You&apos;ll control your agency&apos;s domain and approve agents who join.
                </p>
              </div>
            </Link>

            {/* Agent card */}
            <Link
              href="/signup/agent"
              className="flex items-start gap-4 p-5 rounded-2xl bg-white"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '2px solid #EEF0F4' }}
              onMouseEnter={e => (e.currentTarget.style.border = '2px solid #5E8FD6')}
              onMouseLeave={e => (e.currentTarget.style.border = '2px solid #EEF0F4')}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#E3F4EA' }}>
                <Users className="h-5 w-5" style={{ color: '#1F7A4D' }} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-0.5" style={{ color: '#1A2B4A' }}>I&apos;m an Agent</p>
                <p className="text-xs leading-relaxed" style={{ color: '#7A8499' }}>
                  Join an existing agency. Enter your company&apos;s domain, your name and a password — your manager will approve your account.
                </p>
              </div>
            </Link>
          </div>

          <p className="text-center text-xs mt-8" style={{ color: '#9AA3B2' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold" style={{ color: '#5E8FD6' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
