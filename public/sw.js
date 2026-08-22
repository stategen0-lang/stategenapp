// StateGen service worker.
//
// StateGen is a dynamic, per-user, auth-gated app, so caching is deliberately
// conservative: navigations and API calls always go to the network (never serve
// one user's page to another, never serve stale data), and only static same-origin
// assets (icons, images, fonts) are cached. Its real jobs are (1) making the app
// installable and (2) showing a friendly offline page when there's no network.

const CACHE = 'stategen-static-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, '/icons/icon-192.png'])).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // let cross-origin (fonts, wa.me) pass through
  if (url.pathname.startsWith('/api')) return        // never cache API / auth responses

  // Page navigations: always network-first; fall back to the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  // Static same-origin assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
    }),
  )
})
