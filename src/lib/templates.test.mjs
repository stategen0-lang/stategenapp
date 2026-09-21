// Unit tests for the agency's shared description templates. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeTemplates, activeBody, templateHint, MAX_TEMPLATES, MAX_TEMPLATE_BODY } from './templates.ts'

test('keeps usable templates and drops the rest', () => {
  const out = sanitizeTemplates([
    { id: 't1', name: 'Luxury', body: 'Elegant tone.', active: true },
    { id: 't2', name: 'Standard', body: 'Friendly tone.', active: false },
    { id: 't3', name: '   ', body: '   ' },        // nothing in it
    'not an object', null, 42,
  ])
  assert.deepEqual(out.map(t => t.id), ['t1', 't2'])
  assert.equal(out[0].active, true)
})

test('only one template can be active', () => {
  const out = sanitizeTemplates([
    { id: 'a', name: 'A', body: 'x', active: true },
    { id: 'b', name: 'B', body: 'y', active: true },
  ])
  assert.deepEqual(out.map(t => t.active), [true, false])
  assert.equal(activeBody(out), 'x')
})

test('missing or duplicate ids are repaired', () => {
  const out = sanitizeTemplates([{ name: 'A', body: 'x' }, { id: 'dup', name: 'B', body: 'y' }, { id: 'dup', name: 'C', body: 'z' }])
  assert.equal(new Set(out.map(t => t.id)).size, 3)
})

test('caps the count and the body length', () => {
  const many = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, body: 'x' }))
  assert.equal(sanitizeTemplates(many).length, MAX_TEMPLATES)
  const huge = sanitizeTemplates([{ id: 'big', name: 'Big', body: 'x'.repeat(MAX_TEMPLATE_BODY + 500) }])
  assert.equal(huge[0].body.length, MAX_TEMPLATE_BODY)
})

test('rubbish in, empty list out', () => {
  for (const input of [null, undefined, 'a string', 42, {}]) assert.deepEqual(sanitizeTemplates(input), [])
})

test('activeBody: none active, or an empty body, means none', () => {
  assert.equal(activeBody([{ id: 'a', name: 'A', body: 'x', active: false }]), null)
  assert.equal(activeBody([{ id: 'a', name: 'A', body: '   ', active: true }]), null)
  assert.equal(activeBody([]), null)
})

test('templateHint: the first real line, shortened', () => {
  assert.equal(templateHint('Luxury tone. Elegant language.'), 'Luxury tone. Elegant language.')
  // Leading blank lines are skipped, and the rest of the layout is ignored.
  assert.equal(templateHint('\n\n[Own / Rent] This [Adjective] [Type]!\nA beautifully designed…'), '[Own / Rent] This [Adjective] [Type]!')
  assert.equal(templateHint('x'.repeat(200)).length, 70)
  assert.ok(templateHint('x'.repeat(200)).endsWith('…'))
  assert.equal(templateHint(''), '')
  assert.equal(templateHint(null), '')
})
