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

/** A photo already living in our Storage bucket (vs. a legacy base64 blob). */
export function isStoredPhoto(url: string): boolean {
  return typeof url === 'string' && url.includes(`/storage/v1/object/public/${PHOTO_BUCKET}/`)
}
