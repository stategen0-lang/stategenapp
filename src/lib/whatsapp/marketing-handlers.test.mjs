// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/marketing-handlers.test.mjs
//
// "Send #45 to marketing" over WhatsApp. This one leaves the company — an email
// with the listing and its photos goes to an address the agency set — so the
// rules worth guarding are about who may send, when the bot offers, and that
// nothing is sent before the agent confirms.
//
// The send itself (SMTP) is not exercised here; marketing-email.test.mjs covers
// what the email says. What is exercised is everything that decides whether it
// goes at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './fake-db.mjs'
import { offerMarketing, requestMarketing, actorOf } from './marketing-handlers.ts'
import { marketingEligibility, marketingRecipients } from '../marketing-send.ts'
// The bot's own reply-to-text helper: a BotReply is a plain string when the
// answer is a refusal, and an object when there are buttons to tap.
import { replyText } from './cloud.ts'

const AGENT = { id: 'u1', company_id: 1, role: 'agent', agent_code: 'NH-1', Full_name: 'Nour Haddad' }
const OTHER = { id: 'u2', company_id: 1, role: 'agent', agent_code: 'SM-2', Full_name: 'Sara Mansour' }
const BOSS  = { id: 'u3', company_id: 1, role: 'manager', agent_code: 'MG-9', Full_name: 'The Manager' }

const seed = (marketingEmail = 'marketing@agency.com') => fakeDb({
  Companies: [{ id: 1, Name: 'Test Agency', marketing_email: marketingEmail }],
  Properties: [
    { id: 45, company_id: 1, Title: 'Sea view apartment', Price: 500000, Status: 'Available',
      Amenities: JSON.stringify({ agentId: 'NH-1', type: 'Apartment' }) },
  ],
  pending_actions: [],
})

// SMTP is configured per-server; these tests must not depend on the machine.
const withMail = async (on, fn) => {
  const before = { ...process.env }
  if (on) Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p' })
  else for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k]
  try { return await fn() } finally { process.env = before }
}

// ── Who may send, and when ──────────────────────────────────────────────────

test('the listing agent can send, and it is staged rather than sent', async () => {
  await withMail(true, async () => {
    const db = seed()
    const reply = await requestMarketing(db.client, AGENT, 45, 'https://stategen.app')
    assert.match(reply.text, /Send #45/)
    assert.match(reply.text, /Sea view apartment/)
    assert.match(reply.text, /marketing@agency\.com/, 'the agent cannot see where it would go')
    // Buttons, so a tap is a confirmation.
    assert.equal(reply.buttons.length, 2)

    const pending = db.table('pending_actions').at(-1)
    assert.ok(pending, 'nothing was staged, so a "yes" would send nothing')
    assert.equal(pending.action_type, 'send_marketing')
    assert.equal(pending.payload.table, 'marketing')
    assert.equal(pending.payload.id, 45)
  })
})

test('a manager can send anybody\'s listing', async () => {
  await withMail(true, async () => {
    const db = seed()
    const reply = await requestMarketing(db.client, BOSS, 45, 'https://stategen.app')
    assert.match(replyText(reply), /Send #45/)
  })
})

test('another agent cannot send this listing', async () => {
  await withMail(true, async () => {
    const db = seed()
    const reply = await requestMarketing(db.client, OTHER, 45, 'https://stategen.app')
    assert.match(replyText(reply), /Only the listing's agent or a manager/i)
    assert.equal(db.table('pending_actions').length, 0)
  })
})

test('a listing that does not exist is said plainly', async () => {
  await withMail(true, async () => {
    const db = seed()
    assert.match(replyText(await requestMarketing(db.client, AGENT, 999, 'https://x')), /no listing #999/i)
  })
})

test('no marketing address set up tells the agent who can fix it', async () => {
  await withMail(true, async () => {
    const db = seed('')
    const reply = replyText(await requestMarketing(db.client, AGENT, 45, 'https://x'))
    assert.match(reply, /No marketing email is set up/i)
    assert.match(reply, /manager/i, 'the agent is not told who can fix it')
    assert.equal(db.table('pending_actions').length, 0)
  })
})

test('with no mail server configured, nothing is offered', async () => {
  await withMail(false, async () => {
    const db = seed()
    const reply = replyText(await requestMarketing(db.client, AGENT, 45, 'https://x'))
    assert.match(reply, /not configured/i)
    assert.equal(db.table('pending_actions').length, 0)
  })
})

// ── The offer after photos ──────────────────────────────────────────────────

test('the bot offers only when sending would actually work', async () => {
  await withMail(true, async () => {
    // Eligible: the agent is asked.
    const ok = seed()
    const offered = await offerMarketing(ok.client, AGENT, 45, 'https://x', 'Saved. ')
    assert.ok(offered, 'the agent was not offered a send that would have worked')
    assert.match(offered.text, /^Saved\. /, 'the lead-in was dropped')

    // Not eligible: silence, rather than a question that would only fail.
    const noEmail = seed('')
    assert.equal(await offerMarketing(noEmail.client, AGENT, 45, 'https://x', ''), null)

    const notMine = seed()
    assert.equal(await offerMarketing(notMine.client, OTHER, 45, 'https://x', ''), null)
  })
})

test('with no mail server, the bot stays quiet after photos', async () => {
  await withMail(false, async () => {
    const db = seed()
    assert.equal(await offerMarketing(db.client, AGENT, 45, 'https://x', ''), null)
  })
})

// ── The agency's address list ───────────────────────────────────────────────

test('several marketing addresses are all used', async () => {
  const db = fakeDb({ Companies: [{ id: 1, marketing_email: 'a@x.com, b@x.com; c@x.com' }] })
  assert.deepEqual(await marketingRecipients(db.client, 1), ['a@x.com', 'b@x.com', 'c@x.com'])
})

test('an agency with no address set reads as not set up, not as an error', async () => {
  const db = fakeDb({ Companies: [{ id: 1, marketing_email: null }] })
  assert.equal(await marketingRecipients(db.client, 1), null)
})

test('eligibility names the listing, so the question can quote it', async () => {
  await withMail(true, async () => {
    const db = seed()
    const e = await marketingEligibility(db.client, actorOf(AGENT), 45)
    assert.equal(e.ok, true)
    assert.equal(e.title, 'Sea view apartment')
    assert.deepEqual(e.to, ['marketing@agency.com'])
  })
})
