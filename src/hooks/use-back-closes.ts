import { useEffect, useRef } from 'react'

// How many of these sheets are open, one on top of another. Counted here rather
// than read from history so Strict Mode's mount / unmount / mount lands on the
// same number.
let openSheets = 0

// A sheet opened on top of another sheet: the phone's back button closes just
// that one and lands on what was underneath, instead of leaving the page and
// taking everything with it. Same idea as the photo viewer's history entry.
//
// Each entry records how deep it is, and a sheet closes only when history has
// gone back past its own depth. Every open sheet hears every popstate, so
// "this isn't my entry" would not do: when the sheet above closes, or the photo
// viewer on top of it, the ones below must stay open.
export function useBackCloses(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    const depth = ++openSheets
    // Strict Mode unmounts and remounts straight away: keep the entry we have.
    if (leaving.current !== null) {
      clearTimeout(leaving.current)
      leaving.current = null
    } else {
      window.history.pushState({ sheetDepth: depth }, '')
    }
    let pushed = true
    const onPopState = () => {
      if ((window.history.state?.sheetDepth ?? 0) >= depth) return
      pushed = false
      closeRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      openSheets--
      window.removeEventListener('popstate', onPopState)
      // Closed some other way (✕, tap outside, pull down): take our entry back
      // out, so the next back press isn't spent on a sheet already gone. On the
      // next tick, so a remount can still cancel it.
      if (pushed) {
        leaving.current = setTimeout(() => {
          leaving.current = null
          window.history.back()
        }, 0)
      }
    }
  }, [open])
}
