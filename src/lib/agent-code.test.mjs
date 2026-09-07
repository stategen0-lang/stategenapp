// Unit tests for agent-code generation. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateAgentCode } from './agent-code.ts'

test('generateAgentCode: two-word name uses first+last initials', () => {
  assert.match(generateAgentCode('John Doe'), /^JD-\d{3}$/)
  assert.match(generateAgentCode('  maria   khoury '), /^MK-\d{3}$/)
})
test('generateAgentCode: single word uses first two letters', () => {
  assert.match(generateAgentCode('Rami'), /^RA-\d{3}$/)
})
test('generateAgentCode: three+ words use first and last', () => {
  assert.match(generateAgentCode('Jean Paul Aoun'), /^JA-\d{3}$/)
})
test('generateAgentCode: empty name falls back to AG-###', () => {
  assert.match(generateAgentCode(''), /^AG-\d{3}$/)
  assert.match(generateAgentCode('   '), /^AG-\d{3}$/)
})
test('generateAgentCode: number is in 100-999', () => {
  for (let i = 0; i < 50; i++) {
    const n = Number(generateAgentCode('Test User').split('-')[1])
    assert.ok(n >= 100 && n <= 999, String(n))
  }
})
