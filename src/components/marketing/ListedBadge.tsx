'use client'

import type { Property } from '@/lib/data'

// "Listed" — this listing has been emailed to the marketing team, so it is out
// on OLX, Instagram and Facebook (or on its way).
//
// It answers a question an agent otherwise has to ask a colleague: is this one
// already advertised? Without it the only trace was inside the listing, in a
// panel that is hidden from anyone who can't send — so the agent most likely to
// re-send it by mistake was the one who couldn't see it had already gone.
//
// Shown to everyone in the agency. Whether a listing has been advertised is not
// private the way an owner's phone number is, and the whole point is that a
// colleague can see it.

/** The date, for the tooltip — "Sent to marketing · 12 Oct by Nour". */
export function sentToMarketingLabel(at: string, by?: string): string {
  const d = new Date(at)
  const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `Sent to marketing${when ? ` · ${when}` : ''}${by ? ` by ${by}` : ''}`
}

export function isListed(p: Pick<Property, 'marketingSentAt'>): boolean {
  return !!p.marketingSentAt?.trim()
}

/**
 * `tone="onPhoto"` sits over the card's photo, where every chip is translucent
 * white-on-dark; `tone="onLight"` sits on the modal's white header.
 */
export default function ListedBadge({
  property: p,
  tone = 'onLight',
}: {
  property: Pick<Property, 'marketingSentAt' | 'marketingSentBy'>
  tone?: 'onPhoto' | 'onLight'
}) {
  if (!isListed(p)) return null
  const title = sentToMarketingLabel(p.marketingSentAt!, p.marketingSentBy)

  return (
    <span
      title={title}
      aria-label={title}
      className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={tone === 'onPhoto'
        ? { background: 'rgba(0,0,0,0.28)', color: '#fff' }
        : { background: '#E8F1E9', color: '#1F7A4D' }}
    >
      📣 Listed
    </span>
  )
}
