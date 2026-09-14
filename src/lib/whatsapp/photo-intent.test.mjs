// Unit tests for reading messages around listing photos (photo-intent.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPhotoDone, isPhotoChatter, parsePhotoTarget, parseCaptionTarget, appendPhoto, photoCount,
} from './photo-intent.ts'

// The reported bug: small talk before the photos closed the window, so every
// photo after it was answered "Sorry, I didn't understand that".
test('isPhotoChatter: what agents type before sending the photos keeps the window open', () => {
  for (const s of ['ok', 'Okay', 'thanks', 'sending now', 'here are the photos', 'Sending pics',
    'one sec', 'wait', '👍', 'tamam', 'here u go the pictures']) {
    assert.equal(isPhotoChatter(s), true, `should keep the window: ${s}`)
  }
})

test('isPhotoChatter: real requests still end the window', () => {
  for (const s of ['set Ahmed\'s budget to 400k', 'info on Dana', 'mark #23 as sold', 'photos for #23', '', 'what matches 500k in Beirut']) {
    assert.equal(isPhotoChatter(s), false, `should not be chatter: ${s}`)
  }
})

test('isPhotoDone: done and its Lebanese forms', () => {
  for (const s of ['done', 'Done!', "that's all", 'no more', 'khalas', '5alas']) assert.equal(isPhotoDone(s), true, s)
  for (const s of ['ok', 'not done yet?', '']) assert.equal(isPhotoDone(s), false, s)
})

test('parsePhotoTarget: the ways to name a listing for photos', () => {
  assert.equal(parsePhotoTarget('photos for #23'), 23)
  assert.equal(parsePhotoTarget('Photos for #23'), 23)          // the one-tap button title
  assert.equal(parsePhotoTarget('add pics to 45'), 45)
  assert.equal(parsePhotoTarget('#12 photos'), 12)
  assert.equal(parsePhotoTarget('photos listing 7'), 7)
  assert.equal(parsePhotoTarget('12 pictures'), 12)
})

test('parsePhotoTarget: no photo word, no target', () => {
  assert.equal(parsePhotoTarget('mark #23 as sold'), null)
  assert.equal(parsePhotoTarget('send me the link for #23'), null)
  assert.equal(parsePhotoTarget('here are the photos'), null)    // chatter, not a target
  assert.equal(parsePhotoTarget(''), null)
})

test('parseCaptionTarget: a photo captioned with the listing number', () => {
  assert.equal(parseCaptionTarget('#23'), 23)
  assert.equal(parseCaptionTarget('23'), 23)
  assert.equal(parseCaptionTarget('#23 living room'), 23)
  assert.equal(parseCaptionTarget('living room'), null)
  assert.equal(parseCaptionTarget('2 bedrooms'), null)
  assert.equal(parseCaptionTarget(undefined), null)
})

test('parseCaptionTarget: inside a window a bare number is a label, not a listing', () => {
  assert.equal(parseCaptionTarget('2', { allowBareNumber: false }), null)
  assert.equal(parseCaptionTarget('#2', { allowBareNumber: false }), 2)
})

test('appendPhoto: appends to the existing list', () => {
  const r = appendPhoto(JSON.stringify(['a.jpg']), 'b.jpg')
  assert.equal(r.ok, true)
  assert.deepEqual(JSON.parse(r.json), ['a.jpg', 'b.jpg'])
  assert.equal(r.count, 2)
})

test('appendPhoto: empty/null column starts a list', () => {
  assert.deepEqual(JSON.parse(appendPhoto(null, 'a.jpg').json), ['a.jpg'])
  assert.deepEqual(JSON.parse(appendPhoto('', 'a.jpg').json), ['a.jpg'])
  assert.deepEqual(JSON.parse(appendPhoto('[]', 'a.jpg').json), ['a.jpg'])
})

test('appendPhoto: a retried delivery is not added twice', () => {
  assert.deepEqual(appendPhoto(JSON.stringify(['a.jpg']), 'a.jpg'), { ok: false, reason: 'duplicate' })
})

test('appendPhoto: never overwrites a value it cannot read', () => {
  // Starting a fresh list here would wipe the listing's existing photos.
  assert.deepEqual(appendPhoto('a.jpg,b.jpg', 'c.jpg'), { ok: false, reason: 'unreadable' })
  assert.deepEqual(appendPhoto('{"x":1}', 'c.jpg'), { ok: false, reason: 'unreadable' })
})

test('photoCount: tolerant', () => {
  assert.equal(photoCount('["a","b"]'), 2)
  assert.equal(photoCount(null), 0)
  assert.equal(photoCount('junk'), 0)
})
