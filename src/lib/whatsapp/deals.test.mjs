// Unit tests for pipeline language (src/lib/whatsapp/deals.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coerceDealTarget, findStageInText, stageLabel, targetLabel } from './deals.ts'

test('coerceDealTarget: plain stages clear the outcome', () => {
  assert.deepEqual(coerceDealTarget('negotiating'), { stage: 'negotiating', outcome: null })
  assert.deepEqual(coerceDealTarget('viewing'), { stage: 'viewing', outcome: null })
  assert.deepEqual(coerceDealTarget('LEAD'), { stage: 'lead', outcome: null })
})
test('coerceDealTarget: synonyms map onto stages', () => {
  assert.equal(coerceDealTarget('negotiation')?.stage, 'negotiating')
  assert.equal(coerceDealTarget('offer')?.stage, 'negotiating')
  assert.equal(coerceDealTarget('showing')?.stage, 'viewing')
  assert.equal(coerceDealTarget('contact')?.stage, 'contacted')
})
test('coerceDealTarget: won/lost imply a closed deal with that outcome', () => {
  assert.deepEqual(coerceDealTarget('won'), { stage: 'closed', outcome: 'won' })
  assert.deepEqual(coerceDealTarget('sold'), { stage: 'closed', outcome: 'won' })
  assert.deepEqual(coerceDealTarget('lost'), { stage: 'closed', outcome: 'lost' })
})
test('coerceDealTarget: bare "closed" leaves the outcome unknown (caller asks)', () => {
  assert.deepEqual(coerceDealTarget('closed'), { stage: 'closed', outcome: undefined })
})
test('coerceDealTarget: nonsense and empty return null', () => {
  assert.equal(coerceDealTarget('banana'), null)
  assert.equal(coerceDealTarget(''), null)
  assert.equal(coerceDealTarget(undefined), null)
})

test('findStageInText: pulls a stage out of a query', () => {
  assert.equal(findStageInText("what's in negotiation"), 'negotiating')
  assert.equal(findStageInText('show me viewings'), 'viewing')
  assert.equal(findStageInText('anything in the lead column'), 'lead')
  assert.equal(findStageInText('who did we win'), 'closed')     // won → closed
})
test('findStageInText: no stage word → null (whole pipeline)', () => {
  assert.equal(findStageInText('show my pipeline'), null)
  assert.equal(findStageInText('my deals'), null)
})

test('stageLabel / targetLabel read nicely', () => {
  assert.equal(stageLabel('negotiating'), 'Negotiating')
  assert.equal(targetLabel({ stage: 'negotiating', outcome: null }), 'Negotiating')
  assert.equal(targetLabel({ stage: 'closed', outcome: 'won' }), 'Closed (won)')
  assert.equal(targetLabel({ stage: 'closed', outcome: 'lost' }), 'Closed (lost)')
  assert.equal(targetLabel({ stage: 'closed', outcome: undefined }), 'Closed')
})
