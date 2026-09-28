// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/booking-intent.test.mjs
//
// Booking something in the calendar from a chat, reported from the field
// (28 September 2026). Two failures, both in classification:
//
//   "Showing tomorrow @4:00 pm for charbel salameh"
//       → "Sorry, I didn't understand that."
//   "Book my schedule tomorrow @4:00 pm / Showing for charbel salameh"
//       → "Nothing scheduled for Tuesday 29 September."
//
// The second is the worse one: the agent was answered with an agenda, so it
// read as if the bot had done something. Neither was a time-parsing problem —
// "@4:00 pm" parsed correctly the whole time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickIntent } from './quick-intent.ts'
import { parseWhen } from './when.ts'

const intentOf = t => quickIntent(t)?.intent ?? null

test('the two messages from the field are bookings', () => {
  assert.equal(intentOf('Showing tomorrow @4:00 pm for charbel salameh'), 'create_event')
  assert.equal(intentOf('Book my schedule tomorrow @4:00 pm\nShowing for charbel salameh'), 'create_event')
})

test('"showing" is a calendar word, in singular and plural', () => {
  // It was missing from the list entirely, which is what broke both messages —
  // half the agents say showing, the other half viewing.
  for (const text of [
    'showing tomorrow at 4pm for charbel',
    'Showing tomorrow at 4:00 pm for charbel salameh',
    'book a showing tomorrow at 3pm',
  ]) {
    assert.equal(intentOf(text), 'create_event', text)
  }
  assert.equal(intentOf('what showings tomorrow'), 'query_schedule')
})

test('a calendar word and a future time is a booking, with no command verb', () => {
  // How an agent writes it standing outside the building.
  for (const text of [
    'viewing tomorrow at 4pm with charbel',
    'meeting friday 10am',
    'visit tomorrow 11am',
    'appointment tomorrow at 9',
  ]) {
    assert.equal(intentOf(text), 'create_event', text)
  }
})

test('a calendar word about the PAST is not a booking', () => {
  // The guard that makes the rule above safe: reporting on a viewing that
  // happened must not put a new one in the diary.
  assert.equal(intentOf('the viewing yesterday went well'), null)
  assert.equal(intentOf('the showing last week was cancelled'), null)
})

test('questions about the calendar stay questions', () => {
  for (const text of [
    "what's on today",
    'my schedule tomorrow',
    'what viewings do I have tomorrow',
    'anything booked tomorrow?',
    'show me my calendar',
    'show me my viewings',
    'whats on tomorrow',
  ]) {
    assert.equal(intentOf(text), 'query_schedule', text)
  }
})

test('a booking verb with a future time is never answered as a question', () => {
  // "Book my schedule tomorrow at 4" contains the word "schedule", which used
  // to win — and being answered with today's agenda looks like it worked.
  for (const text of [
    'Book my schedule tomorrow @4:00 pm',
    'book my calendar tomorrow at 4pm',
    'add to my schedule tomorrow 5pm',
  ]) {
    assert.equal(intentOf(text), 'create_event', text)
  }
})

test('listings are still listings', () => {
  // "showing" and "visit" must not steal a property message.
  assert.equal(intentOf('mark property #23 as sold'), 'update_property')
  assert.equal(intentOf('what matches 500k in Beirut'), 'query_property')
  assert.equal(intentOf('set property #23 price to 520k'), 'update_property')
})

test('the time itself was never the problem', () => {
  // Kept so nobody "fixes" the parser looking for this bug.
  const now = new Date('2026-09-28T10:00:00')
  for (const text of ['tomorrow @4:00 pm', 'tomorrow at 4:00 pm', 'tomorrow @ 4pm', 'tomorrow at 3pm']) {
    const w = parseWhen(text, now)
    assert.ok(w, text)
    assert.equal(w.allDay, false, text)
  }
  assert.equal(parseWhen('Showing tomorrow @4:00 pm for charbel salameh', now).start.getHours(), 16)
})
