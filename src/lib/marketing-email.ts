// "Send to marketing": the email a listing becomes when an agent hands it to the
// marketing team to post on OLX, Instagram, Facebook and the like.
//
// Layout, top to bottom — the order the marketing team works in:
//   1. the stamp: the listing's single strongest selling point
//   2. the description, ready to paste into a post (English, then Arabic)
//   3. the photos, full width (attached to the email, so they can be saved)
//
// And nothing else. A listing card — title, price, a facts table, the contact
// and a link to the listing page — used to close the email and was dropped at
// the agency's request: the team posts the description and the photos, so the
// card was a second copy of the same listing to scroll past. The subject line
// carries the listing number and who sent it, and the reply goes to the agency.
//
// Only public-safe fields reach this module (see publicListing in share.ts): the
// email leaves the company, so the owner's name and number, internal notes and
// private documents must never be in it.
//
// Pure: relative, type-only imports so the test runner can load it.

import type { PublicListing } from './share.ts'
import { propertyStamp } from './listing-stamp.ts'

export const MAX_MARKETING_RECIPIENTS = 5

const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/

/**
 * Parse the manager's "marketing email" setting: one or more addresses split by
 * commas, semicolons or spaces. Returns the cleaned list, or an error naming the
 * first bad address so the settings screen can say exactly what's wrong.
 */
export function parseRecipients(raw: unknown): { ok: true; emails: string[] } | { ok: false; error: string } {
  const parts = String(raw ?? '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  const emails = [...new Set(parts)]
  const bad = emails.find(e => !EMAIL.test(e))
  if (bad) return { ok: false, error: `"${bad}" isn't a valid email address.` }
  if (emails.length > MAX_MARKETING_RECIPIENTS) {
    return { ok: false, error: `Up to ${MAX_MARKETING_RECIPIENTS} addresses.` }
  }
  return { ok: true, emails }
}

export interface MarketingEmailInput {
  listing: PublicListing
  listingId: number
  /** Public share page for the listing (/l/<token>). */
  shareUrl: string
  agentName: string
  /** The agent's WhatsApp/phone, as the contact to put on the post. */
  agentPhone?: string | null
  companyName?: string | null
  brandColor?: string | null
  /**
   * Photos attached to the email as regular files, keyed by position in
   * listing.photos, with the attachment's filename. They are deliberately NOT
   * referenced inline (cid:): Gmail hides inline images from the attachment
   * strip, which removed hover-download and "Download all". The body shows each
   * photo from its URL instead, and clicking it downloads the file.
   */
  attachedFiles?: Record<number, string>
}

const STORED = '/storage/v1/object/public/'

/**
 * The link a photo opens. For a photo in our Supabase storage, `?download=` makes
 * storage serve it as a file download (named) rather than showing it full screen
 * in the browser with no way to save it. Other URLs are left untouched.
 */
export function photoDownloadUrl(src: string, filename: string): string {
  if (!src.includes(STORED)) return src
  try {
    const u = new URL(src)
    u.searchParams.set('download', filename)
    return u.toString()
  } catch { return src }
}

const photoFilename = (listingId: number, i: number, src: string) => {
  const ext = /\.(jpe?g|png|webp|gif)(?:$|\?)/i.exec(src)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpg'
  return `listing-${listingId}-photo-${i + 1}.${ext}`
}

export interface MarketingEmail { subject: string; html: string; text: string }

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * A block of the agency's own writing, for the HTML half of the email.
 *
 * An agency's template is a layout — headings, bullet lists, a blank line
 * before "More Features:" — and that shape is the whole reason they wrote a
 * template. CSS cannot carry it through email: Outlook's Word engine ignores
 * `white-space` outright and Gmail strips it in places, so every line ran
 * together into one paragraph and the email arrived looking cramped.
 *
 * <br> is the one thing every client renders. Leading spaces are held with
 * &nbsp; as well, because HTML collapses them and an indented list would
 * otherwise lose its step.
 */
export function htmlText(text: unknown): string {
  return esc(String(text ?? '').replace(/\r\n?/g, '\n'))
    .split('\n')
    .map(line => line.replace(/^ +/, spaces => '&nbsp;'.repeat(spaces.length)))
    .join('<br>')
}

/**
 * A long run of digits and the punctuation a phone number or a price is written
 * with. Six digits or more, so a bedroom count or a floor is left alone.
 */
const LTR_RUN = /(\+?\d[\d٠-٩ ().\-/]{4,}\d)/g

/**
 * The same, for the Arabic half.
 *
 * Arabic runs right to left, and a phone number written in Western digits is a
 * left-to-right island inside it. Left to the bidi algorithm the pieces are laid
 * out in the wrong order — +961 76 884 433 arrived reading "433 884 76 961+",
 * which is not a number anybody can ring. Each run is marked as its own
 * left-to-right direction so it reads the way it was written.
 */
export function htmlArabic(text: unknown): string {
  return htmlText(text).replace(LTR_RUN, '<span dir="ltr">$1</span>')
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function priceLine(l: Pick<PublicListing, 'transaction' | 'price' | 'rent'>): string {
  if (l.transaction === 'For Rent') return l.rent > 0 ? `${money(l.rent)}/month` : 'Price on request'
  return l.price > 0 ? money(l.price) : 'Price on request'
}

const place = (l: Pick<PublicListing, 'district' | 'city'>) => [l.district, l.city].filter(Boolean).join(', ')

/**
 * A plain description for a listing that has none written, so the email always
 * opens with text the team can paste into a post.
 */
export function fallbackDescription(l: PublicListing): string {
  const beds = l.beds > 0
    ? ` with ${l.beds} bedroom${l.beds > 1 ? 's' : ''}${l.baths > 0 ? ` and ${l.baths} bathroom${l.baths > 1 ? 's' : ''}` : ''}`
    : ''
  const extras = [l.garden && 'a private garden', l.balcony && 'a balcony', l.terrace && 'a terrace', l.view && `${l.view.toLowerCase()} views`]
    .filter(Boolean).join(', ')
  const where = place(l)
  const sentence = `${l.size > 0 ? `${l.size} m² ` : ''}${l.type.toLowerCase()}${where ? ` in ${where}` : ''}${beds}, ${l.transaction.toLowerCase()} at ${priceLine(l)}.${extras ? ` Featuring ${extras}.` : ''}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export function renderMarketingEmail(input: MarketingEmailInput): MarketingEmail {
  const { listing: l, listingId, agentName } = input
  const accent = /^#[0-9a-f]{6}$/i.test(input.brandColor ?? '') ? input.brandColor! : '#14223F'
  const files = input.attachedFiles ?? {}
  const where = place(l)
  // The agent's name goes early, not at the end: the marketing team works from
  // the inbox list, where a long subject is cut off, and who sent it is the
  // first thing they need in order to reply. With the listing card gone this is
  // also the only place the listing number and the sender appear, which is the
  // argument for having put them there.
  const from = agentName?.trim() ? ` from ${agentName.trim()}` : ''
  const subject = `New listing #${listingId}${from} to post: ${l.title}${where ? ` — ${where}` : ''}`
  const description = l.description.trim() || fallbackDescription(l)
  const arabic = l.descriptionAr?.trim() ?? ''
  const stamp = propertyStamp(l)
  const attachedCount = l.photos.filter((_, i) => files[i]).length
  const linkedPhotos = l.photos.filter((_, i) => !files[i])
  const downloadOf = (src: string, i: number) => photoDownloadUrl(src, files[i] ?? photoFilename(listingId, i, src))

  const photoNote = !l.photos.length ? ''
    : attachedCount === l.photos.length
      ? `All ${attachedCount} photo${attachedCount === 1 ? ' is' : 's are'} attached to this email — tap one to download it, or use "Download all" in the attachments.`
      : attachedCount
        ? `${attachedCount} of ${l.photos.length} photos are attached (the rest were too large to attach). Tap any photo to download it.`
        : 'Tap a photo to download it.'

  const text = [
    `★ ${stamp.text.toUpperCase()} · ${stamp.ar}`,
    '',
    description,
    // Both versions ready to paste, the Arabic clearly separated so nobody
    // posts the two languages as one block.
    ...(arabic ? ['', '--- العربية ---', arabic] : []),
    '',
    l.photos.length ? `Photos: ${l.photos.length}${attachedCount ? ` (${attachedCount} attached)` : ''}` : 'No photos yet.',
    ...linkedPhotos.map(src => photoDownloadUrl(src, photoFilename(listingId, l.photos.indexOf(src), src))),
    // The listing card is gone from both versions — see the HTML above.
  ].join('\n')

  const photoBlocks = (photoNote ? `<p style="margin:0 0 10px;font-size:13px;color:#6A7488">${esc(photoNote)}</p>` : '')
    + l.photos.map((src, i) => `
      <a href="${esc(downloadOf(src, i))}" download="${esc(files[i] ?? photoFilename(listingId, i, src))}" style="display:block;margin:0 0 10px;text-decoration:none">
        <img src="${esc(src)}" alt="Photo ${i + 1}" width="620" style="display:block;width:100%;max-width:620px;height:auto;border-radius:10px;border:1px solid #EEF0F4">
      </a>`).join('')

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F7F8FB;font-family:Arial,Helvetica,sans-serif;color:#14223F">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto">

    <!-- 0. The stamp: the listing's single strongest selling point -->
    <tr><td style="padding:0 0 12px">
      <span style="display:inline-block;background:${accent};color:#ffffff;font-size:12px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;padding:9px 16px;border-radius:8px">
        ${esc(stamp.text)}&nbsp; · &nbsp;<span dir="rtl" lang="ar" style="letter-spacing:0">${esc(stamp.ar)}</span>
      </span>
    </td></tr>

    <!-- 1. Description -->
    <tr><td style="background:#ffffff;border:1px solid #EEF0F4;border-radius:14px;padding:22px">
      <p style="margin:0;font-size:15px;line-height:1.65">${htmlText(description)}</p>
      ${arabic ? `<p dir="rtl" lang="ar" style="margin:16px 0 0;padding-top:16px;border-top:1px solid #EEF0F4;font-size:15px;line-height:1.8;text-align:right">${htmlArabic(arabic)}</p>` : ''}
    </td></tr>

    <!-- 2. Photos -->
    <tr><td style="padding:14px 0 4px">
      ${l.photos.length ? photoBlocks : '<p style="margin:0 0 10px;font-size:13px;color:#6A7488">No photos yet.</p>'}
    </td></tr>

    <!-- The listing card that used to sit here — the facts table, the contact
         and the listing-page button — was removed at the agency's request. The
         marketing team works from the description and the photos; everything
         else was a second copy of the same listing for them to scroll past. The
         subject line still carries the listing number and who sent it. -->
  </table>
  <p style="text-align:center;font-size:11px;color:#9AA3B2;margin-top:14px">Sent from StateGen</p>
</body></html>`

  return { subject, html, text }
}
