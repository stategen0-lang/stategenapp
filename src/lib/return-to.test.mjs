// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/return-to.test.mjs
//
// The `from` on a deep link reaches router.push(), and it comes out of a URL,
// so most of this is about what must NOT be accepted.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { returnTo, withReturn } from './return-to.ts'

test('an in-app path is kept, query and all', () => {
  assert.equal(returnTo('/activity'), '/activity')
  assert.equal(returnTo('/pipeline?stage=viewing'), '/pipeline?stage=viewing')
  assert.equal(returnTo('  /activity  '), '/activity')
})

test('anything that could leave the app is refused', () => {
  for (const bad of [
    'https://evil.example.com',
    '//evil.example.com',            // protocol-relative — the classic one
    '/\\/evil.example.com',          // a backslash some browsers read as "/"
    'javascript:alert(1)',           // eslint-disable-line no-script-url
    'activity',                      // relative: resolves against the current page
    '',
    null,
    undefined,
  ]) assert.equal(returnTo(bad), null, String(bad))
})

test('an absurdly long path is refused', () => {
  assert.equal(returnTo('/' + 'a'.repeat(400)), null)
})

test('withReturn appends, respecting an existing query', () => {
  assert.equal(withReturn('/properties?open=7', '/activity'), '/properties?open=7&from=%2Factivity')
  assert.equal(withReturn('/calendar', '/activity'), '/calendar?from=%2Factivity')
})

test('withReturn leaves the link alone when there is nowhere safe to go back to', () => {
  // A phone notification opens a listing from the lock screen: there is no
  // previous page, so the modal just closes.
  assert.equal(withReturn('/properties?open=7', null), '/properties?open=7')
  assert.equal(withReturn('/properties?open=7', 'https://evil.example.com'), '/properties?open=7')
})
