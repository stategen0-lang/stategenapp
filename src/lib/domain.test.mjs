import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDomain } from './domain.ts'

test('normalizeDomain: strips protocol, www, path, case, spaces', () => {
  const want = 'equitypropertieslb.com'
  assert.equal(normalizeDomain('equitypropertieslb.com'), want)
  assert.equal(normalizeDomain('www.equitypropertieslb.com'), want)
  assert.equal(normalizeDomain('https://equitypropertieslb.com'), want)
  assert.equal(normalizeDomain('https://www.EquityPropertiesLB.com/'), want)
  assert.equal(normalizeDomain('  EquityPropertiesLB.com  '), want)
  assert.equal(normalizeDomain('http://equitypropertieslb.com/agents'), want)
  assert.equal(normalizeDomain('@equitypropertieslb.com'), want)
  assert.equal(normalizeDomain('equitypropertieslb.com.'), want)
})

test('normalizeDomain: strips invisible characters (the real "no company found" bug)', () => {
  const want = 'equitypropertieslb.com'
  assert.equal(normalizeDomain('equityproperties​lb.com'), want)   // zero-width space mid-string
  assert.equal(normalizeDomain('equitypropertieslb.com​'), want)   // trailing zero-width
  assert.equal(normalizeDomain('equitypropertieslb .com'), want)   // non-breaking space
  assert.equal(normalizeDomain('﻿equitypropertieslb.com'), want)   // leading BOM
})

test('normalizeDomain: empty / nullish → empty string', () => {
  assert.equal(normalizeDomain(''), '')
  assert.equal(normalizeDomain(null), '')
  assert.equal(normalizeDomain(undefined), '')
})
