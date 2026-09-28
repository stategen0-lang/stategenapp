// A stand-in for `next/server` under `node --test`.
//
// The bot handlers import `after()` to defer work off the response path. Node
// cannot resolve next/server outside Next's build, and the test does not want
// the deferral anyway — it wants to see what the handler does. So `after` runs
// the callback immediately, and anything it throws is swallowed exactly as the
// real one's callers assume.
export function after(fn) {
  try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch { /* as in production */ }
}

export const NextResponse = {
  json: (body, init) => ({ body, status: init?.status ?? 200, json: async () => body }),
}
export class NextRequest {}
