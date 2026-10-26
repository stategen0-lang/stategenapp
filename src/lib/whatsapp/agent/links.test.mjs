// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/agent/links.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withListingLinks, mentionedIds } from './links.ts'

const O = 'https://stategen.app'

test('every listing a search reply names gets its link; client numbers and linked ones are left alone', () => {
  const reply = '- *#64*: 150 m², USD 300,000\n- *#43*: 196 m² https://stategen.app/properties?open=43\nClient #12 asked too.'
  const out = withListingLinks(reply, new Set([64, 43]), O)
  assert.match(out, /Link:\n#64 https:\/\/stategen\.app\/properties\?open=64$/)
  assert.equal((out.match(/open=43/g) ?? []).length, 1, 'already linked: not again')
  assert.doesNotMatch(out, /open=12/, 'a client number is not a listing')
  assert.deepEqual(mentionedIds('#5 and #5 and #7'), [5, 7])
  assert.equal(withListingLinks('no listings here', new Set([1]), O), 'no listings here')
})
