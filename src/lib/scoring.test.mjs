// Unit tests for the lead scoring engine (src/lib/scoring.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recencyScore, engagementScore, behaviorScore,
  budgetClarityScore, timelineScore, profileFitScore,
  ratingScore, leadScore, scoreBand,
} from './scoring.ts'

// ── behavior: recency (today=100 → 0 at 30+ days) ───────────────────────────
test('recencyScore: today → 100, 30+ days → 0, linear between', () => {
  assert.equal(recencyScore(0), 100)
  assert.equal(recencyScore(15), 50)
  assert.equal(recencyScore(30), 0)
  assert.equal(recencyScore(45), 0)
})

// ── behavior: engagement (events last 14 days, capped at 3) ─────────────────
test('engagementScore: 0 events → 0, cap at 3+ → 100', () => {
  assert.equal(engagementScore(0), 0)
  assert.equal(engagementScore(1), 33)
  assert.equal(engagementScore(3), 100)
  assert.equal(engagementScore(9), 100)
  assert.equal(engagementScore(-2), 0)
})

test('behaviorScore: blends recency 60% / engagement 40%', () => {
  assert.equal(behaviorScore(0, 3), 100)   // active today + busy
  assert.equal(behaviorScore(30, 0), 0)    // a month quiet
  assert.equal(behaviorScore(0, 0), 60)    // active today, no events
})

// ── profile fit ─────────────────────────────────────────────────────────────
test('budgetClarityScore: defined budget → 100, missing → 20', () => {
  assert.equal(budgetClarityScore(500000), 100)
  assert.equal(budgetClarityScore(0), 20)
})

test('timelineScore: status as intent proxy', () => {
  assert.equal(timelineScore('Negotiation'), 100)
  assert.equal(timelineScore('Signed'), 100)
  assert.equal(timelineScore('Viewing'), 70)
  assert.equal(timelineScore('Searching'), 40)
  assert.equal(timelineScore('whatever'), 20)
})

test('profileFitScore: average of budget clarity, timeline, best match', () => {
  assert.equal(profileFitScore(500000, 'Negotiation', 100), 100)
  assert.equal(profileFitScore(0, 'Searching', 0), 20)      // (20+40+0)/3
  assert.equal(profileFitScore(500000, 'Viewing', 80), 83)  // (100+70+80)/3
  assert.equal(profileFitScore(500000, 'Viewing', 250), 90) // best match clamped to 100
})

// ── agent rating (1-5 stars → 20-100, junk clamps to default 3) ─────────────
test('ratingScore: star mapping and clamping', () => {
  assert.equal(ratingScore(1), 20)
  assert.equal(ratingScore(3), 60)
  assert.equal(ratingScore(5), 100)
  assert.equal(ratingScore(0), 60)
  assert.equal(ratingScore(99), 60)
  assert.equal(ratingScore(NaN), 60)
})

// ── final score (50/30/20 weights) ──────────────────────────────────────────
test('leadScore: spec weights 50/30/20', () => {
  assert.equal(leadScore(100, 100, 100), 100)
  assert.equal(leadScore(0, 0, 0), 0)
  assert.equal(leadScore(100, 0, 0), 50)
  assert.equal(leadScore(0, 100, 0), 30)
  assert.equal(leadScore(0, 0, 100), 20)
  assert.equal(leadScore(80, 60, 60), 70)  // 40+18+12
})

// ── bands ───────────────────────────────────────────────────────────────────
test('scoreBand: hot ≥70, warm 40-69, cold <40', () => {
  assert.equal(scoreBand(100), 'hot')
  assert.equal(scoreBand(70), 'hot')
  assert.equal(scoreBand(69), 'warm')
  assert.equal(scoreBand(40), 'warm')
  assert.equal(scoreBand(39), 'cold')
  assert.equal(scoreBand(0), 'cold')
})
