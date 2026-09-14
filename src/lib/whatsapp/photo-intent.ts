// Reading the messages around "send photos for a listing". Pure, so the wording
// rules are testable without WhatsApp or a database. Run: npm test

// "done" / "that's all" ends the photo window.
const DONE = /^(done|finish(ed)?|skip|no more|that'?s? (all|it)|stop|khalas|khalass|5alas|5lss?)\b/i

export function isPhotoDone(text: string | null | undefined): boolean {
  return DONE.test(String(text ?? '').trim())
}

/**
 * Small talk an agent sends around the photos — "ok", "sending now", "here are
 * the pics". This used to close the window silently, so every photo that came
 * after it was answered with "Sorry, I didn't understand that".
 */
const CHATTER = /^(ok(ay)?|k|sure|great|perfect|thanks?|thank you|merci|tyt?|yes|yep|yeah|ey|eh|tamam|wait|one (sec|second|min(ute)?)|sec|hold on|coming|sending( (them|now|it))?)\b[\s.!👍🙏]*$/i
const PHOTO_TALK = /\b(photos?|pics?|pictures?|images?|imgs?|sowar|swar|sura|soura)\b/i

export function isPhotoChatter(text: string | null | undefined): boolean {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (/^[\s👍🙏✅👌📸]+$/u.test(s)) return true
  if (CHATTER.test(s)) return true
  // "here are the photos", "sending pics now" — about photos, but no listing id
  // (that case is a target, handled by parsePhotoTarget) and short.
  return PHOTO_TALK.test(s) && !/#?\d/.test(s) && s.length <= 60
}

/**
 * Which listing a text asks to add photos to: "photos for #23", "add pics to
 * 23", "#23 photos", "photos 23". Needs a photo word, so "mark #23 as sold" is
 * never read as one.
 */
export function parsePhotoTarget(text: string | null | undefined): number | null {
  const s = String(text ?? '').trim()
  if (!s || s.includes('\n') || !PHOTO_TALK.test(s)) return null
  const m = s.match(/#\s*(\d{1,9})\b/)
    || s.match(/\b(?:listing|property|prop|unit)\s*#?\s*(\d{1,9})\b/i)
    || s.match(/\b(?:photos?|pics?|pictures?|images?)\s+(?:for|to|of|on)?\s*(\d{1,9})\b/i)
    || s.match(/^(\d{1,9})\s+(?:photos?|pics?|pictures?|images?)\b/i)
  return m ? Number(m[1]) : null
}

/**
 * The listing a photo's own caption names: a bare "#23" or "23", or any of the
 * text forms above. Lets an agent attach photos without opening a window first.
 */
export function parseCaptionTarget(
  caption: string | null | undefined,
  { allowBareNumber = true }: { allowBareNumber?: boolean } = {},
): number | null {
  const s = String(caption ?? '').trim()
  if (!s) return null
  // A bare "2" is only a listing number when no window is open; inside one it is
  // far more likely a photo's own label, and must not redirect it elsewhere.
  const bare = s.match(allowBareNumber ? /^#?\s*(\d{1,9})$/ : /^#\s*(\d{1,9})$/)
  if (bare) return Number(bare[1])
  const tagged = s.match(/^#\s*(\d{1,9})\b/)
  if (tagged) return Number(tagged[1])
  return parsePhotoTarget(s)
}

/**
 * Append a URL to a listing's Photos JSON. 'duplicate' when the URL is already
 * there (a retried delivery). 'unreadable' when the column holds something that
 * isn't a JSON list: the caller must not overwrite it, or the listing's existing
 * photos would be wiped to make room for this one.
 */
export type AppendResult =
  | { ok: true; json: string; count: number }
  | { ok: false; reason: 'duplicate' | 'unreadable' }

export function appendPhoto(raw: unknown, url: string): AppendResult {
  let photos: unknown
  if (raw === null || raw === undefined || raw === '') photos = []
  else if (typeof raw === 'string') {
    try { photos = JSON.parse(raw) } catch { return { ok: false, reason: 'unreadable' } }
  } else photos = raw
  if (!Array.isArray(photos)) return { ok: false, reason: 'unreadable' }
  if (photos.includes(url)) return { ok: false, reason: 'duplicate' }
  const next = [...photos, url]
  return { ok: true, json: JSON.stringify(next), count: next.length }
}

export function photoCount(raw: unknown): number {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(parsed) ? parsed.length : 0
  } catch { return 0 }
}
