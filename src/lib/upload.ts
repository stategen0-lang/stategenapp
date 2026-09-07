// Image upload validation.
//
// The bucket is public, so anything that lands in it is served to the world at
// a guessable-ish URL. A declared Content-Type is set by the browser and can be
// lied about, so the real check is the file's own magic bytes — a .exe renamed
// to .jpg does not have a JPEG signature. Pure, so the sniffing is unit-tested.

/** Largest photo we accept, in bytes. Phone photos are ~2-5 MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024   // 8 MB

/** Formats a real-estate photo can arrive in, keyed by extension. */
const SIGNATURES: { ext: string; mime: string; test: (b: Uint8Array) => boolean }[] = [
  { ext: 'jpg',  mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  mime: 'image/png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'gif',  mime: 'image/gif',  test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  // WEBP: "RIFF"...."WEBP"
  { ext: 'webp', mime: 'image/webp', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
]

export interface Sniffed {
  ext: string
  mime: string
}

/**
 * Identify an image by its leading bytes, or null if it isn't one we accept.
 * The caller rejects a null — never trust the extension or the declared type.
 */
export function sniffImage(bytes: Uint8Array): Sniffed | null {
  const hit = SIGNATURES.find(s => s.test(bytes))
  return hit ? { ext: hit.ext, mime: hit.mime } : null
}

export interface ValidationResult {
  ok: boolean
  error?: string
  ext?: string
  mime?: string
}

/** Validate size and true type together. */
export function validateUpload(bytes: Uint8Array): ValidationResult {
  if (!bytes.length) return { ok: false, error: 'The file is empty.' }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `Image is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).` }
  }
  const sniffed = sniffImage(bytes)
  if (!sniffed) return { ok: false, error: 'That file is not a supported image (JPEG, PNG, WebP or GIF).' }
  return { ok: true, ext: sniffed.ext, mime: sniffed.mime }
}

/**
 * Storage path for a new photo: scoped by company so one agency's uploads are
 * grouped, with a random name so two photos of the same second don't collide
 * and a filename can't be guessed from the property.
 */
export function photoPath(companyId: number, ext: string, rand: string = randomId()): string {
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin'
  return `company-${companyId}/${rand}.${safeExt}`
}

function randomId(): string {
  // Not security-critical; just needs to be collision-resistant enough.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export const PHOTO_BUCKET = 'property-photos'

// ── Private documents ────────────────────────────────────────────────────────
//
// Owner-facing paperwork (title deeds, contracts, ID scans) is confidential, so
// it lives in a SEPARATE, private bucket — never the public photo bucket. It is
// only ever served through a permission-checked, short-lived signed URL, so a
// leaked path alone grants nothing.

export const DOC_BUCKET = 'property-documents'

/** Documents can be a little larger than photos (scanned contracts). */
export const MAX_DOC_BYTES = 10 * 1024 * 1024   // 10 MB

/** Accepted document formats: PDF, Word (.doc/.docx) and any image. */
const DOC_SIGNATURES: { ext: string; mime: string; test: (b: Uint8Array) => boolean }[] = [
  { ext: 'pdf',  mime: 'application/pdf', test: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  // Legacy Office (.doc/.xls): OLE compound-file header.
  { ext: 'doc',  mime: 'application/msword', test: b => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  // Modern Office (.docx) is a ZIP ("PK"). We can't tell it from a plain zip by
  // bytes alone, but the bucket is private and access is permission-gated, so we
  // accept the zip signature and label it .docx.
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: b => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
]

/** Validate a document upload by size and true type (image, PDF or Word). */
export function validateDocument(bytes: Uint8Array): ValidationResult {
  if (!bytes.length) return { ok: false, error: 'The file is empty.' }
  if (bytes.length > MAX_DOC_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.round(MAX_DOC_BYTES / 1024 / 1024)} MB).` }
  }
  const img = sniffImage(bytes)
  if (img) return { ok: true, ext: img.ext, mime: img.mime }
  const hit = DOC_SIGNATURES.find(s => s.test(bytes))
  if (hit) return { ok: true, ext: hit.ext, mime: hit.mime }
  return { ok: false, error: 'Unsupported file. Upload a PDF, Word document, or image.' }
}

/** Storage path for a private document, scoped and randomised like a photo. */
export function documentPath(companyId: number, ext: string, rand: string = randomId()): string {
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin'
  return `company-${companyId}/${rand}.${safeExt}`
}

// ── Walkthrough videos ───────────────────────────────────────────────────────
//
// Raw phone videos are far too big for a server upload (a Serverless Function
// caps the request body at ~4.5 MB), so videos go straight from the browser to
// Storage via a signed upload URL — our server only mints the token, it never
// carries the bytes. The bucket is public so the file plays from a plain URL.

export const VIDEO_BUCKET = 'property-videos'

/** A generous cap for a short walkthrough clip. */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024   // 150 MB

/** Container formats phones actually produce. */
export const VIDEO_MIME_TYPES = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
  'video/3gpp', 'video/x-matroska',
]
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', '3gp', 'mkv'])

/** Keep only an extension we recognise, defaulting to mp4. */
export function safeVideoExt(ext: string): string {
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, '')
  return VIDEO_EXTS.has(e) ? e : 'mp4'
}

export function videoPath(companyId: number, ext: string, rand: string = randomId()): string {
  return `company-${companyId}/${rand}.${safeVideoExt(ext)}`
}

/** A photo already living in our Storage bucket (vs. a legacy base64 blob). */
export function isStoredPhoto(url: string): boolean {
  return typeof url === 'string' && url.includes(`/storage/v1/object/public/${PHOTO_BUCKET}/`)
}
