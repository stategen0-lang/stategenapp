'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Left/right swipe to move between the main tabs on touch devices. Order must
// match the bottom tab bar in AppSidebar.
const TABS = ['/dashboard', '/properties', '/clients', '/pipeline', '/calendar', '/analytics', '/settings']

// Don't treat a touch as a tab-swipe if it belongs to something that owns
// horizontal gestures itself: a horizontally-scrollable area (e.g. the Pipeline
// board), a form field, or an open dialog.
function ownsHorizontalGesture(target: EventTarget | null): boolean {
  let node = target as HTMLElement | null
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const tag = node.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable) return true
      if (node.getAttribute('role') === 'dialog') return true
      const ox = getComputedStyle(node).overflowX
      if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 4) return true
    }
    node = node.parentElement
  }
  return false
}

export default function SwipeNav() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const idx = TABS.indexOf(pathname)
    if (idx === -1) return   // on a non-tab page (e.g. a detail route) — no swipe nav

    let startX = 0, startY = 0, startT = 0, skip = false

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { skip = true; return }
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY; startT = Date.now()
      // Leave the left screen edge to iOS's back-swipe, and skip anything that
      // owns its own horizontal gesture.
      skip = startX < 24 || ownsHorizontalGesture(e.target)
    }

    const onEnd = (e: TouchEvent) => {
      if (skip) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      const dt = Date.now() - startT
      if (dt > 600) return                          // a slow drag isn't a swipe
      if (Math.abs(dx) < 70) return                 // too short
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return // must be clearly horizontal
      const next = TABS[idx + (dx < 0 ? 1 : -1)]    // swipe left → next tab
      if (next) router.push(next)
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
    }
  }, [pathname, router])

  return null
}
