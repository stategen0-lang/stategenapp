// Unit tests for upload validation (src/lib/upload.ts).
// The magic-byte sniff is what stops a disguised non-image reaching a public
// bucket, so it is tested hardest.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sniffImage, validateUpload, photoPath, isStoredPhoto,
  MAX_UPLOAD_BYTES, PHOTO_BUCKET,
} from './upload.ts'

// Real leading bytes for each format.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG  = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF  = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

// ── Sniffing ────────────────────────────────────────────────────────────────
test('sniffImage: recognises the four accepted formats', () => {
  assert.equal(sniffImage(JPEG).ext, 'jpg')
  assert.equal(sniffImage(PNG).ext, 'png')
  assert.equal(sniffImage(GIF).ext, 'gif')
  assert.equal(sniffImage(WEBP).ext, 'webp')
})
test('sniffImage: returns the right mime type', () => {
  assert.equal(sniffImage(JPEG).mime, 'image/jpeg')
  assert.equal(sniffImage(WEBP).mime, 'image/webp')
})
test('sniffImage: rejects a non-image', () => {
  // "MZ" — a Windows executable.
  assert.equal(sniffImage(new Uint8Array([0x4d, 0x5a, 0x90, 0])), null)
  // Plain text.
  assert.equal(sniffImage(new Uint8Array([0x68, 0x69, 0x21])), null)
  assert.equal(sniffImage(new Uint8Array([])), null)
})
test('sniffImage: a RIFF that is not WEBP is rejected', () => {
  // RIFF...WAVE (an audio file) shares the RIFF header but is not WEBP.
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
  assert.equal(sniffImage(wav), null)
})

// ── Validation ──────────────────────────────────────────────────────────────
test('validateUpload: accepts a real image', () => {
  const r = validateUpload(PNG)
  assert.equal(r.ok, true)
  assert.equal(r.ext, 'png')
})
test('validateUpload: rejects an empty file', () => {
  const r = validateUpload(new Uint8Array([]))
  assert.equal(r.ok, false)
  assert.match(r.error, /empty/i)
})
test('validateUpload: rejects an oversized file', () => {
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1)
  big.set(PNG)   // valid header, but too big
  const r = validateUpload(big)
  assert.equal(r.ok, false)
  assert.match(r.error, /too large/i)
})
test('validateUpload: rejects a disguised non-image', () => {
  // The attack this guards: a script renamed .jpg. No JPEG signature.
  const script = new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e])   // "#!/bin"
  const r = validateUpload(script)
  assert.equal(r.ok, false)
  assert.match(r.error, /not a supported image/i)
})

// ── Paths ───────────────────────────────────────────────────────────────────
test('photoPath: scoped by company, keeps the extension', () => {
  const p = photoPath(1, 'jpg', 'abc123')
  assert.equal(p, 'company-1/abc123.jpg')
})
test('photoPath: two calls do not collide', () => {
  assert.notEqual(photoPath(1, 'png'), photoPath(1, 'png'))
})
test('photoPath: sanitises a hostile extension', () => {
  const p = photoPath(1, '../../etc/passwd', 'r')
  assert.equal(p, 'company-1/r.bin')
})

// ── Legacy detection ────────────────────────────────────────────────────────
test('isStoredPhoto: distinguishes a stored URL from a base64 blob', () => {
  assert.equal(isStoredPhoto(`https://x.supabase.co/storage/v1/object/public/${PHOTO_BUCKET}/company-1/a.jpg`), true)
  assert.equal(isStoredPhoto('data:image/png;base64,iVBOR...'), false)
  assert.equal(isStoredPhoto('https://images.unsplash.com/photo-123'), false)
})
