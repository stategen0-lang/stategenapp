import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { readMapsPaste, parseLatLng, allowedMapsHost } from '@/lib/maps-link'

// Turn a pasted Google Maps link into coordinates.
//
// The phone's Share button gives a shortened link with nothing in it, so the
// only way to read one is to follow it and see where it lands. That means the
// server fetching an address a person typed, which is exactly the shape of
// request that gets a server used as somebody else's proxy — so:
//
//   • the host is checked against a closed list BEFORE the first request, and
//     again at every redirect, because hop two is under nobody's control;
//   • redirects are followed by hand, at most MAX_HOPS of them;
//   • the response body is never read and never returned — only the final URL
//     is looked at;
//   • it is signed-in only, and there is a short timeout.

const MAX_HOPS = 5
const TIMEOUT_MS = 6000

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const verdict = readMapsPaste(body?.url)

  if (verdict.kind === 'error') return NextResponse.json({ error: verdict.error }, { status: 400 })
  if (verdict.kind === 'point') return NextResponse.json({ point: verdict.point })

  // A short link: follow it.
  let url = verdict.url
  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (!allowedMapsHost(url)) {
        return NextResponse.json({ error: 'That link led somewhere outside Google Maps.' }, { status: 400 })
      }

      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Google serves a different, coordinate-free page to something that
        // looks like a bot.
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StateGen/1.0)' },
      })

      const next = res.headers.get('location')
      if (next) {
        // A relative redirect is resolved against the hop it came from, then
        // re-checked like any other.
        url = new URL(next, url).toString()
        const point = parseLatLng(url)
        if (point) return NextResponse.json({ point })
        continue
      }

      // No further redirect: this is where it ends.
      const point = parseLatLng(res.url || url)
      if (point) return NextResponse.json({ point })
      break
    }
  } catch {
    return NextResponse.json({ error: 'That link could not be opened. Try again, or tap the map instead.' }, { status: 502 })
  }

  return NextResponse.json({
    error: 'That link did not lead to a place. Open it in Google Maps, tap the pin, then Share again — or tap the map below.',
  }, { status: 400 })
}
