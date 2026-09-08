import { useEffect } from 'react'

// Lock the page behind a modal so scrolling inside the modal never "chains" to
// the page underneath (the classic mobile bug where the background scrolls
// instead of the open sheet). Uses position:fixed on <body> — the only approach
// that reliably stops iOS Safari's momentum scroll — and restores the exact
// scroll position when the modal closes. Call it once at the top of any modal;
// the lock lifts automatically on unmount.
export function useLockBodyScroll() {
  useEffect(() => {
    const { body } = document
    const scrollY = window.scrollY
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    }
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      body.style.overflow = prev.overflow
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      window.scrollTo(0, scrollY)
    }
  }, [])
}
