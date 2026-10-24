// Seals the simulator off from everything real, once the snapshot is loaded.
//
// The bot's code can reach the database (createAdminClient), WhatsApp (Graph
// API), email (SMTP), push notifications (web-push) and Grok. In the simulator
// a bug, or a tool doing exactly what it does in production, must not be able
// to message a real agent, email a marketing team or write a real row. So:
//
//   1. Every credential is removed from the environment except the model APIs'.
//      Code that builds a client from them finds nothing to build one with.
//   2. The network is closed except to the model APIs: fetch, and the raw
//      http/https/net/tls connects underneath anything that bypasses fetch.
//
// Both, because either alone has a gap: (1) does nothing about a client created
// before it ran, (2) does nothing about a library with its own transport.
//
// Calls that are allowed are also recorded — the request and the response —
// against the conversation that made them (AsyncLocalStorage), which is how
// the judge sees what the bot's tools returned and how the cost is counted.

import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

export const ALLOWED_HOSTS = new Set(['api.anthropic.com'])

/** Per-conversation capture: { calls: [], blocked: [] }. */
export const scope = new AsyncLocalStorage()

/** Everything blocked, across all conversations — a non-empty list is a finding. */
export const blocked = []

/** Token usage per model, across everything (bot, persona and judge). */
export const usage = {}

const KEEP = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'WHATSAPP_AGENT_MODEL', 'WHATSAPP_AGENT_EFFORT', 'APP_TIMEZONE'])
const SECRET = /SUPABASE|SMTP|WHATSAPP|VAPID|TWILIO|CRON|ADMIN|SECRET|TOKEN|KEY|PASS/i

function hostOf(input) {
  try {
    if (typeof input === 'string') return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    if (input?.url) return new URL(input.url).hostname
  } catch { /* fall through */ }
  return ''
}

function recordUsage(model, u) {
  if (!model || !u) return
  const m = (usage[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 })
  m.input += u.input_tokens ?? 0
  m.output += u.output_tokens ?? 0
  m.cacheRead += u.cache_read_input_tokens ?? 0
  m.cacheWrite += u.cache_creation_input_tokens ?? 0
  m.calls += 1
}

function refuse(where, host) {
  const entry = { where, host, at: new Date().toISOString() }
  blocked.push(entry)
  scope.getStore()?.blocked.push(entry)
  return new Error(`[sim] blocked ${where} to ${host || 'unknown host'} — the simulator only talks to the model APIs`)
}

export function lockdown({ companyId }) {
  for (const k of Object.keys(process.env)) {
    if (KEEP.has(k)) continue
    if (SECRET.test(k)) delete process.env[k]
  }
  // The agent is on for the simulated agency, whatever production says.
  process.env.WHATSAPP_AGENT = String(companyId)
  // As production runs it (the user's standing choice).
  process.env.WHATSAPP_AGENT_MODEL = 'claude-haiku-5-5'
  // Fake mail settings, so "send to marketing" is tested as production runs it
  // rather than refused as unconfigured. The host doesn't exist and the
  // network is closed below, so nothing can be sent.
  process.env.SMTP_HOST = 'smtp.sim.invalid'
  process.env.SMTP_USER = 'sim@sim.invalid'
  process.env.SMTP_PASS = 'not-a-password'

  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const host = hostOf(input)
    if (!ALLOWED_HOSTS.has(host)) throw refuse('fetch', host)
    const res = await realFetch(input, init)
    if (host === 'api.anthropic.com') {
      let body = null
      try { body = JSON.parse(String(init?.body ?? 'null')) } catch { /* not JSON */ }
      try {
        const json = await res.clone().json()
        recordUsage(json?.model ?? body?.model, json?.usage)
        scope.getStore()?.calls.push({ request: body, response: json, status: res.status })
      } catch { /* streaming or not JSON — usage unknown */ }
    }
    return res
  }

  const guardConnect = (where, original) => function (...args) {
    const opts = typeof args[0] === 'object' && args[0] !== null ? args[0] : { host: typeof args[1] === 'string' ? args[1] : args[0] }
    const host = String(opts.host ?? opts.hostname ?? opts.servername ?? '')
    if (!ALLOWED_HOSTS.has(host)) throw refuse(where, host)
    return original.apply(this, args)
  }
  net.connect = guardConnect('net.connect', net.connect)
  net.createConnection = guardConnect('net.createConnection', net.createConnection)
  tls.connect = guardConnect('tls.connect', tls.connect)
  for (const [name, mod] of [['http', http], ['https', https]]) {
    for (const fn of ['request', 'get']) {
      const original = mod[fn]
      mod[fn] = function (...args) {
        const a = args[0]
        const host = typeof a === 'string' ? hostOf(a) : a instanceof URL ? a.hostname : String(a?.hostname ?? a?.host ?? '')
        if (!ALLOWED_HOSTS.has(host)) throw refuse(`${name}.${fn}`, host)
        return original.apply(this, args)
      }
    }
  }
}

// $ per million tokens. Cache writes 1.25×, cache reads 0.1× the input price.
const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
}

export function costSoFar() {
  let total = 0
  for (const [model, u] of Object.entries(usage)) {
    const key = Object.keys(PRICES).find(k => model.startsWith(k))
    const [inp, out] = PRICES[key] ?? [4, 20]
    total += (u.input * inp + u.cacheWrite * inp * 1.25 + u.cacheRead * inp * 0.1 + u.output * out) / 1e6
  }
  return total
}
