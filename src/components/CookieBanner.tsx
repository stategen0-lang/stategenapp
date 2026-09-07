'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem('cookie_notice_dismissed')) setVisible(true)
    } catch {}
  }, [])

  function dismiss() {
    try { localStorage.setItem('cookie_notice_dismissed', '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-5 py-3 text-sm"
      style={{ background: '#0E1F3D', color: '#C8D6EA' }}
    >
      <p className="flex-1">
        We use only essential cookies to keep you signed in.{' '}
        <Link href="/cookie-policy" className="underline" style={{ color: '#5E8FD6' }}>
          Cookie Policy
        </Link>
      </p>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-80"
        style={{ background: '#5E8FD6' }}
      >
        Got it
      </button>
    </div>
  )
}
