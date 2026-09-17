import { useEffect, useRef, useState } from 'react'

// Mobile gesture: pull down on a full-screen/sheet modal while it's scrolled
// all the way to the top and it closes, the same way a client or property
// detail page "swipes back" to the list it was opened from. Only engages when
// the scrollable content is at scrollTop 0 — pulling down mid-list just
// scrolls normally, exactly like iOS/Android's native pull-to-dismiss.
//
// scrollRef goes on the modal's scrollable content div; panelRef goes on the
// sheet/card that should visually follow the finger. `pulling` and `progress`
// (0–1) are exposed so the caller can show a "release to go back" hint.
const TRIGGER_PX = 90     // raw finger travel needed to trigger close
const MAX_VISUAL_PX = 70  // cap on how far the panel visually slides
const DRAG_RATIO = 0.45   // resistance — panel moves slower than the finger

export function usePullToClose(onClose: () => void) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pulling, setPulling] = useState(false)
  const [progress, setProgress] = useState(0)
  const startY = useRef<number | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    const panel = panelRef.current
    if (!el || !panel) return

    function setTransform(px: number, animate: boolean) {
      if (!panel) return
      panel.style.transition = animate ? 'transform 0.2s ease' : ''
      panel.style.transform = px > 0 ? `translateY(${px}px)` : ''
    }

    function onTouchStart(e: TouchEvent) {
      startY.current = el!.scrollTop <= 0 ? e.touches[0].clientY : null
      dragging.current = false
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0 || el!.scrollTop > 0) { startY.current = null; if (dragging.current) { setTransform(0, true); setPulling(false); setProgress(0); dragging.current = false }; return }
      dragging.current = true
      setPulling(true)
      const visual = Math.min(dy * DRAG_RATIO, MAX_VISUAL_PX)
      setTransform(visual, false)
      setProgress(Math.min(dy / TRIGGER_PX, 1))
      // Stop the page underneath from doing its own pull-to-refresh while we drag.
      e.preventDefault()
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging.current) { startY.current = null; return }
      const dy = startY.current != null ? (e.changedTouches[0].clientY - startY.current) : 0
      setTransform(0, true)
      setPulling(false)
      setProgress(0)
      dragging.current = false
      startY.current = null
      if (dy > TRIGGER_PX) onClose()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  return { scrollRef, panelRef, pulling, progress }
}
