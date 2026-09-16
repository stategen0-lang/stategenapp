// Unit tests for reading the session's expiry from the cookie (proxy-session.ts).
// This decides whether the proxy skips its verification call, so every shape and
// every failure mode is covered: when in doubt it must NOT skip. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSessionHint, canSkipVerification, authCookieValue, jwtExpiryMs, fastSessionEnabled, REFRESH_WINDOW_MS } from './proxy-session.ts'

const NOW = 1_800_000_000_000            // fixed "now" in ms
const b64 = s => Buffer.from(s, 'utf8').toString('base64')
const jwt = exp => `header.${Buffer.from(JSON.stringify({ sub: 'u1', exp }), 'utf8').toString('base64url')}.sig`
const session = (expSec, extra = {}) => ({ access_token: jwt(expSec), expires_at: expSec, ...extra })
const cookie = (value, name = 'sb-abcdefgh-auth-token') => [{ name, value }]

// ── The shapes @supabase/ssr actually writes ────────────────────────────────
test('plain JSON session cookie', () => {
  const exp = NOW / 1000 + 3600
  assert.deepEqual(readSessionHint(cookie(JSON.stringify(session(exp)))), { present: true, expiresAt: exp * 1000 })
})

test('base64- prefixed session cookie', () => {
  const exp = NOW / 1000 + 3600
  const hint = readSessionHint(cookie('base64-' + b64(JSON.stringify(session(exp)))))
  assert.equal(hint.expiresAt, exp * 1000)
})

test('array-wrapped session (older @supabase/ssr)', () => {
  const exp = NOW / 1000 + 3600
  assert.equal(readSessionHint(cookie(JSON.stringify([session(exp), null]))).expiresAt, exp * 1000)
})

test('chunked cookies are joined in index order', () => {
  const exp = NOW / 1000 + 3600
  const whole = JSON.stringify(session(exp))
  const half = Math.ceil(whole.length / 2)
  // Deliberately out of order, as a cookie jar may present them.
  const cookies = [
    { name: 'sb-abcdefgh-auth-token.1', value: whole.slice(half) },
    { name: 'sb-abcdefgh-auth-token.0', value: whole.slice(0, half) },
  ]
  assert.equal(authCookieValue(cookies), whole)
  assert.equal(readSessionHint(cookies).expiresAt, exp * 1000)
})

test('falls back to the JWT exp when expires_at is missing', () => {
  const exp = NOW / 1000 + 3600
  const hint = readSessionHint(cookie(JSON.stringify({ access_token: jwt(exp) })))
  assert.equal(hint.expiresAt, exp * 1000)
})

test('other cookies are ignored', () => {
  const cookies = [{ name: 'theme', value: 'dark' }, { name: 'sb-abcdefgh-auth-token-code-verifier', value: 'x' }]
  assert.deepEqual(readSessionHint(cookies), { present: false, expiresAt: null })
})

// ── Anything unreadable must fall back to real verification ────────────────
test('no cookie / empty / junk / wrong types never skip', () => {
  const cases = [
    [],                                                    // signed out
    cookie(''),                                            // empty value
    cookie('not json at all'),
    cookie('base64-@@@not base64@@@'),
    cookie(JSON.stringify({ expires_at: 'soon' })),        // wrong type
    cookie(JSON.stringify({ access_token: 'no-dots' })),   // unparseable JWT
    cookie(JSON.stringify(null)),
    cookie(JSON.stringify([])),
    cookie('base64-' + b64('{"expires_at":')),             // truncated JSON
  ]
  for (const c of cases) {
    assert.equal(canSkipVerification(readSessionHint(c), NOW), false, JSON.stringify(c))
  }
})

// ── The decision ───────────────────────────────────────────────────────────
test('skips only when the token is comfortably valid', () => {
  const at = ms => canSkipVerification(readSessionHint(cookie(JSON.stringify(session(ms / 1000)))), NOW)
  assert.equal(at(NOW + 60 * 60_000), true)                        // an hour left
  assert.equal(at(NOW + REFRESH_WINDOW_MS + 1000), true)           // just outside the window
  assert.equal(at(NOW + REFRESH_WINDOW_MS), false)                 // on the boundary: verify
  assert.equal(at(NOW + 60_000), false)                            // a minute left: verify
  assert.equal(at(NOW), false)                                     // expiring now
  assert.equal(at(NOW - 60_000), false)                            // expired
  assert.equal(at(NOW - 30 * 24 * 3600_000), false)                // long expired
})

test('an expired token is never skipped however it is encoded', () => {
  const expired = NOW / 1000 - 10
  for (const value of [
    JSON.stringify(session(expired)),
    'base64-' + b64(JSON.stringify(session(expired))),
    JSON.stringify([session(expired)]),
    JSON.stringify({ access_token: jwt(expired) }),
  ]) {
    assert.equal(canSkipVerification(readSessionHint(cookie(value)), NOW), false, value.slice(0, 40))
  }
})

test('jwtExpiryMs: reads exp, tolerates rubbish', () => {
  assert.equal(jwtExpiryMs(jwt(1_800_000_000)), 1_800_000_000_000)
  assert.equal(jwtExpiryMs('a.b.c'), null)
  assert.equal(jwtExpiryMs(''), null)
  assert.equal(jwtExpiryMs('onlyonepart'), null)
})

test('the kill switch: only "off" disables the fast path', () => {
  for (const v of [undefined, '', 'on', 'true', 'yes', 'anything']) assert.equal(fastSessionEnabled(v), true, String(v))
  for (const v of ['off', 'OFF', ' Off ']) assert.equal(fastSessionEnabled(v), false, v)
})
