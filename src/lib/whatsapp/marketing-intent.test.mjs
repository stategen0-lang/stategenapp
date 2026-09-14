// Unit tests for parseMarketingRequest (marketing-intent.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarketingRequest, isMarketingRequestWithoutId } from './marketing-intent.ts'

test('parseMarketingRequest: the ways an agent asks', () => {
  assert.equal(parseMarketingRequest('send #45 to marketing'), 45)
  assert.equal(parseMarketingRequest('Send #45 to marketing'), 45)
  assert.equal(parseMarketingRequest('send 45 to marketing'), 45)
  assert.equal(parseMarketingRequest('email listing 45 to marketing'), 45)
  assert.equal(parseMarketingRequest('marketing #45'), 45)
  assert.equal(parseMarketingRequest('marketing 45'), 45)
  assert.equal(parseMarketingRequest('#45 to marketing'), 45)
})

test('parseMarketingRequest: not a send', () => {
  assert.equal(parseMarketingRequest('send #45'), null)                        // no "marketing"
  assert.equal(parseMarketingRequest('send to marketing'), null)               // no listing
  assert.equal(parseMarketingRequest('did #45 go to marketing?'), null)        // a question
  assert.equal(parseMarketingRequest('the marketing team called about 3 listings today and wants more'), null)
  assert.equal(parseMarketingRequest(''), null)
})

test('isMarketingRequestWithoutId: for the listing the agent opened', () => {
  for (const s of ['send it to marketing', 'send to marketing', 'marketing', 'send this listing to the marketing team', 'Send to marketing please']) {
    assert.equal(isMarketingRequestWithoutId(s), true, s)
  }
  for (const s of ['send #45 to marketing', 'the marketing team called', 'did it go to marketing?x', '']) {
    assert.equal(isMarketingRequestWithoutId(s), false, s)
  }
})
