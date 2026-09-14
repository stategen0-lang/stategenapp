// "Send to marketing": the email a listing becomes when an agent hands it to the
// marketing team to post on OLX, Instagram, Facebook and the like.
//
// PLACEHOLDER LAYOUT. The agency is designing its own template; when it arrives,
// replace renderMarketingEmail below. Everything around it — who may send, where
// it goes, what data is safe to include — stays as it is.
//
// Only public-safe fields reach this module (see publicListing in share.ts): the
// email leaves the company, so the owner's name and number, internal notes and
// private documents must never be in it.
//
// Pure: relative, type-only imports so the test runner can load it.

import type { PublicListing } from './share.ts'

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
}

export interface MarketingEmail { subject: string; html: string; text: string }

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function priceLine(l: Pick<PublicListing, 'transaction' | 'price' | 'rent'>): string {
  if (l.transaction === 'For Rent') return l.rent > 0 ? `${money(l.rent)}/month` : 'Price on request'
  return l.price > 0 ? money(l.price) : 'Price on request'
}

const place = (l: Pick<PublicListing, 'district' | 'city'>) => [l.district, l.city].filter(Boolean).join(', ')

/** The facts a post needs, in the order a marketer would copy them. */
export function detailRows(l: PublicListing): [string, string][] {
  const rows: [string, string | false | undefined | null][] = [
    ['Type', `${l.type} · ${l.transaction}`],
    ['Price', priceLine(l)],
    ['Location', place(l)],
    ['Size', l.size > 0 && `${l.size} m²`],
    ['Bedrooms', l.beds > 0 && String(l.beds)],
    ['Bathrooms', l.baths > 0 && String(l.baths)],
    ['Parking', l.parkings ? String(l.parkings) : null],
    ['Furnishing', l.furnishing],
    ['View', l.view],
    ['Building age', l.buildingAge ? `${l.buildingAge} years` : null],
    ['Outdoor', [l.garden && 'Garden', l.balcony && 'Balcony', l.terrace && 'Terrace'].filter(Boolean).join(', ')],
    ['Amenities', [...l.amenities, ...l.buildingFeatures].join(', ')],
  ]
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1].trim() !== '')
}

export function renderMarketingEmail(input: MarketingEmailInput): MarketingEmail {
  const { listing: l, listingId, shareUrl, agentName, agentPhone, companyName } = input
  const accent = /^#[0-9a-f]{6}$/i.test(input.brandColor ?? '') ? input.brandColor! : '#14223F'
  const where = place(l)
  const subject = `New listing #${listingId} to post: ${l.title}${where ? ` — ${where}` : ''}`
  const rows = detailRows(l)
  const contact = [agentName, agentPhone].filter(Boolean).join(' · ')

  const text = [
    `New listing to post${companyName ? ` for ${companyName}` : ''}`,
    '',
    l.title,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    l.description,
    '',
    `Contact for enquiries: ${contact}`,
    `Listing page: ${shareUrl}`,
    '',
    l.photos.length ? `Photos (${l.photos.length}):` : 'No photos yet.',
    ...l.photos,
    l.video ? `\nVideo: ${l.video}` : '',
  ].join('\n')

  const photoGrid = l.photos.map((src, i) => `
    <a href="${esc(src)}" style="display:inline-block;margin:0 6px 6px 0;text-decoration:none">
      <img src="${esc(src)}" alt="Photo ${i + 1}" width="170" style="display:block;width:170px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #EEF0F4">
    </a>`).join('')

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F7F8FB;font-family:Arial,Helvetica,sans-serif;color:#14223F">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #EEF0F4">
    <tr><td style="background:${accent};padding:16px 22px;color:#ffffff;font-size:13px;font-weight:bold">
      New listing to post${companyName ? ` · ${esc(companyName)}` : ''}
    </td></tr>
    <tr><td style="padding:22px">
      <div style="font-size:12px;color:#6A7488">Listing #${listingId}</div>
      <h1 style="margin:4px 0 2px;font-size:22px">${esc(l.title)}</h1>
      <div style="font-size:14px;color:#6A7488">${esc(where)}</div>
      <div style="margin:12px 0 18px;font-size:20px;font-weight:bold">${esc(priceLine(l))}</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #EEF0F4">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:8px 0;color:#6A7488;width:130px;border-bottom:1px solid #EEF0F4">${esc(k)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #EEF0F4">${esc(v)}</td></tr>`).join('')}
      </table>

      ${l.description ? `<p style="font-size:14px;line-height:1.6;white-space:pre-line;margin:18px 0">${esc(l.description)}</p>` : ''}

      <div style="margin:18px 0 8px;font-size:13px;font-weight:bold">${l.photos.length ? `Photos (${l.photos.length}) — click to open full size` : 'No photos yet'}</div>
      <div>${photoGrid}</div>
      ${l.video ? `<p style="font-size:14px"><a href="${esc(l.video)}" style="color:${accent}">Watch the video</a></p>` : ''}

      <div style="margin-top:18px;padding:14px;border-radius:10px;background:#F7F8FB;font-size:14px">
        <strong>Contact for enquiries:</strong> ${esc(contact)}
      </div>
      <p style="margin:18px 0 0"><a href="${esc(shareUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:8px;font-size:14px">Open listing page</a></p>
    </td></tr>
  </table>
  <p style="text-align:center;font-size:11px;color:#9AA3B2;margin-top:14px">Sent from StateGen</p>
</body></html>`

  return { subject, html, text }
}
