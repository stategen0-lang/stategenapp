'use client'

import { useEffect } from 'react'

// Registers the service worker (public/sw.js) once, after the app mounts in the
// browser. Renders nothing. This is what makes StateGen installable and gives it
// the offline fallback page.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {})
    // Wait for load so registration never competes with first paint.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])
  return null
}
