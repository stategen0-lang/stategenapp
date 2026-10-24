import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbRowToProperty } from '@/lib/db-mappers'
import { makeShareToken, shareSecret } from '@/lib/share'
import MicrositeListings, { type MicrositeCard } from '@/components/microsite/MicrositeListings'
import MicrositeContactForm from '@/components/microsite/MicrositeContactForm'

// Public agency microsite: a branded page listing an agency's available
// properties + a contact form that drops a lead into the CRM. Reached at
// /a/<company domain>; portable to the agency's own domain later (a host rewrite
// can point yourdomain.com/ here). Only allowlisted, client-safe fields render.

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>

interface Brand { name: string; logoUrl: string | null; color: string }
type Card = MicrositeCard
interface Site { brand: Brand; cards: Card[] }

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#14223F' : '#ffffff'
}

async function loadSite(slug: string): Promise<{ site: Site; companyId: number } | null> {
  const admin = createAdminClient()
  // A subdomain label (acme) must match a company whose domain is "acme" OR
  // "acme.<tld>" (e.g. acme.com) — the domain carries a dot so agent emails stay
  // valid, but the subdomain can't, so we match on the label prefix too. Sanitise
  // the label to DNS-safe chars before it goes into the filter.
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const { data: matches } = await admin
    .from('Companies').select('*')
    .or(`domain.eq.${safe},domain.ilike.${safe}.*`)
    .limit(1)
  const company = matches?.[0]
  if (!company) return null
  const c = company as Row
  const brand: Brand = {
    name: (c.Name as string) || 'Our Agency',
    logoUrl: (c.logo_url as string) || null,
    color: (c.brand_color as string) || '#14223F',
  }

  const { data: rows } = await admin.from('Properties').select('*').eq('company_id', c.id).order('created_at', { ascending: false })
  const secret = shareSecret()
  const cards: Card[] = (rows ?? [])
    .map((row, i) => ({ p: dbRowToProperty(row as Row, i) }))
    .filter(({ p }) => p.status === 'Available')
    .map(({ p }) => ({
      token: makeShareToken(p.id, secret),
      title: p.title, type: p.type, transaction: p.transaction,
      price: p.price, rent: p.rent, district: p.district, city: p.city,
      beds: p.beds, baths: p.baths, size: p.size,
      // Client-safe listing facts for the badges (the same ones the public listing page shows).
      parkings: p.parkings ?? 0, view: p.view ?? '', terrace: !!p.terrace, balcony: !!p.balcony, garden: !!p.garden,
      photos: (p.photos ?? []).filter(Boolean),
      hasVideo: !!p.video,
    }))

  return { site: { brand, cards }, companyId: c.id as number }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const loaded = await loadSite(slug)
  if (!loaded) return { title: 'Agency — StateGen' }
  const { brand, cards } = loaded.site
  return {
    title: `${brand.name} — Properties`,
    description: `Browse ${cards.length} propert${cards.length === 1 ? 'y' : 'ies'} from ${brand.name}. Contact us to arrange a viewing.`,
    openGraph: { title: brand.name, description: `Properties from ${brand.name}`, images: cards[0]?.photos[0] ? [cards[0].photos[0]] : [] },
  }
}

const H = '#14223F'
const SUB = '#6A7488'

function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F4F5F7' }}>
      <div className="text-center">
        <p className="text-lg font-bold" style={{ color: H }}>Agency not found</p>
        <p className="text-sm mt-1.5" style={{ color: SUB }}>This link may be mistyped or no longer active.</p>
      </div>
    </main>
  )
}

export default async function MicrositePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params
  const query = await searchParams
  const from = query.from
  // The filters in the link (?deal=rent&area=…) — rendered filtered on the first load.
  const initialQuery = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  ).toString()
  const fromApp = from === 'app'   // opened from inside the app (Settings) — offer a way back
  const loaded = await loadSite(slug)
  if (!loaded) return <NotFound />
  const { brand, cards } = loaded.site
  const onAccent = readableOn(brand.color)

  return (
    <main className="min-h-screen pb-16" style={{ background: '#F4F5F7', fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Back-to-app bar — only when opened from the app (never for public visitors) */}
      {fromApp && (
        <a href="/dashboard" className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold" style={{ background: '#0E1F3D', color: '#fff' }}>
          <span aria-hidden>←</span> Back to app
        </a>
      )}

      {/* Header */}
      <div className="px-5 py-5" style={{ background: brand.color }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          {brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[220px] object-contain" style={{ borderRadius: 6 }} />
          )}
          <div>
            <p className="text-xl font-extrabold tracking-tight" style={{ color: onAccent }}>{brand.name}</p>
            <p className="text-xs font-semibold" style={{ color: onAccent, opacity: 0.75 }}>{cards.length} available propert{cards.length === 1 ? 'y' : 'ies'}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5">
        <MicrositeListings cards={cards} accent={brand.color} initialQuery={initialQuery} />

        {/* Contact form */}
        <div className="mt-10 max-w-xl mx-auto">
          <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #EEF0F4', boxShadow: '0 2px 10px rgba(20,34,63,0.06)' }}>
            <p className="text-lg font-bold" style={{ color: H }}>Looking for something specific?</p>
            <p className="text-sm mt-1 mb-4" style={{ color: SUB }}>Tell {brand.name} what you&apos;re after and an agent will reach out.</p>
            <MicrositeContactForm slug={slug} accent={brand.color} onAccent={onAccent} agency={brand.name} />
          </div>
        </div>

        <p className="text-center text-xs mt-8" style={{ color: '#9AA3B2' }}>Presented by {brand.name}</p>
      </div>
    </main>
  )
}
