// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/photo-handlers.test.mjs
//
// Photos over WhatsApp, against a fake database and a fake media download.
// Built from a real conversation (24 Oct 2026): listing #250 was saved, the
// bot said "send photos for it now", and an album sent 27 seconds later got
// "Which listing are these photos for? … send the photos again" — an empty
// event at the head of the album had closed the photo window.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './fake-db.mjs'
import { continuePhotoCollection, attachHeldPhotos, NO_REPLY } from './photo-handlers.ts'
import { replyText } from './cloud.ts'

const COMPANY = 1
const RAMI = { id: 'p-rami', company_id: COMPANY, role: 'agent', agent_code: 'a2', Full_name: 'Rami Saad', whatsapp_number: '96181056376' }
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()

const listing = (id, agent = 'a2', extra = {}) => ({
  id, company_id: COMPANY, Title: `Listing ${id}`, Photos: null,
  Amenities: JSON.stringify({ agentId: agent }), created_at: ago(30), ...extra,
})

function world(tables = {}) {
  const db = fakeDb({
    Properties: [listing(250), listing(251, 'a1')],
    conversation_state: [], pending_actions: [], whatsapp_logs: [],
    ...tables,
  }, { defaults: { '*': () => ({ created_at: new Date().toISOString() }) } })
  let n = 0
  const io = {
    download: async (id) => ({ ok: true, bytes: Buffer.from(`img-${id}`), mime: 'image/jpeg' }),
    store: async () => ({ ok: true, url: `https://cdn.test/p${++n}.jpg` }),
  }
  return { db, io }
}

const photo = (id) => ({ from: RAMI.whatsapp_number, text: '', name: '', messageId: `wamid-${id}`, type: 'image', image: { id: `media-${id}` } })
const empty = { from: RAMI.whatsapp_number, text: '', name: '', messageId: 'wamid-empty', type: 'unsupported' }
const text = (t) => ({ from: RAMI.whatsapp_number, text: t, name: '', messageId: `wamid-${t}`, type: 'text' })

/** What the webhook does: log the inbound row, then hand it over. */
async function send(db, io, inbound) {
  await db.client.from('whatsapp_logs').insert({ profile_id: RAMI.id, company_id: COMPANY, direction: 'inbound', message: inbound.text, wa_message_id: inbound.messageId, from_number: RAMI.whatsapp_number })
  const reply = await continuePhotoCollection(db.client, RAMI, inbound, 'https://stategen.app', io)
  return reply === null ? null : replyText(reply)
}
const photosOn = (db, id) => JSON.parse(db.table('Properties').find(p => p.id === id).Photos ?? '[]')

test('the live case: an empty event at the head of an album no longer closes the window', async () => {
  const { db, io } = world({
    conversation_state: [{ profile_id: RAMI.id, company_id: COMPANY, current_flow: 'collecting_photos', step: 'photos', context: { propertyId: 250 }, updated_at: new Date().toISOString() }],
  })
  assert.equal(await send(db, io, empty), NO_REPLY)
  for (const id of [1, 2, 3, 4]) assert.match(await send(db, io, photo(id)), /saved to #250/)
  assert.equal(photosOn(db, 250).length, 4)
})

test('no window: photos go to the listing the conversation was just about, and the reply says so', async () => {
  const { db, io } = world({
    whatsapp_logs: [{ id: 1, profile_id: RAMI.id, direction: 'outbound', message: 'Saved — listing #250 created.', created_at: ago(5) }],
  })
  const reply = await send(db, io, photo(1))
  assert.match(reply, /saved to #250/)
  assert.match(reply, /the listing we were just on/)
  assert.equal(photosOn(db, 250).length, 1)
})

test('a search result naming several listings is not "the listing we were on"', async () => {
  const { db, io } = world({
    Properties: [listing(250, 'a2', { created_at: ago(60 * 30) }), listing(252, 'a2', { created_at: ago(60 * 30) })],
    whatsapp_logs: [{ id: 1, profile_id: RAMI.id, direction: 'outbound', message: '• #250 Listing 250\n• #252 Listing 252', created_at: ago(5) }],
  })
  const reply = await send(db, io, photo(1))
  assert.match(reply, /Which listing are they for/)
  assert.equal(photosOn(db, 250).length + photosOn(db, 252).length, 0)
})

test("another agent's listing is never picked from context", async () => {
  const { db, io } = world({
    Properties: [listing(251, 'a1', { created_at: ago(60 * 30) })],
    whatsapp_logs: [{ id: 1, profile_id: RAMI.id, direction: 'outbound', message: 'Here is #251 Listing 251', created_at: ago(5) }],
  })
  assert.match(await send(db, io, photo(1)), /Which listing are they for/)
  assert.equal(photosOn(db, 251).length, 0)
})

test('no context: the photos are kept, and naming the listing attaches them — no resending', async () => {
  const { db, io } = world({ Properties: [listing(250, 'a2', { created_at: ago(60 * 30) })] })
  assert.match(await send(db, io, photo(1)), /no need to send them again/)
  await send(db, io, photo(2))
  await send(db, io, photo(3))
  assert.equal(photosOn(db, 250).length, 0)
  const reply = await send(db, io, text('#250'))
  assert.match(reply, /Attached the 3 photos you sent to #250/)
  assert.equal(photosOn(db, 250).length, 3)
  // Attached once only.
  assert.equal(await attachHeldPhotos(db.client, RAMI, 250, io), 0)
})

test('the "Photos for #250" button also attaches what was already sent', async () => {
  const { db, io } = world({ Properties: [listing(250, 'a2', { created_at: ago(60 * 30) })] })
  await send(db, io, photo(1))
  await send(db, io, photo(2))
  assert.match(await send(db, io, text('Photos for #250')), /Attached the 2 photos/)
  assert.equal(photosOn(db, 250).length, 2)
})

test('photos sent while the new listing waits on YES are kept for it', async () => {
  const { db, io } = world({
    pending_actions: [{ id: 9, profile_id: RAMI.id, action_type: 'create_property', expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: ago(1) }],
  })
  assert.match(await send(db, io, photo(1)), /reply YES to save the listing and I'll attach them/)
  assert.equal(photosOn(db, 250).length, 0)
  // What applyPendingAction does once the listing is saved:
  assert.equal(await attachHeldPhotos(db.client, RAMI, 250, io), 1)
  assert.equal(photosOn(db, 250).length, 1)
})
