import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbRowToProperty } from '@/lib/db-mappers'
import { makeShareToken, shareSecret } from '@/lib/share'
import { formatPrice, TYPE_GRADIENTS } from '@/lib/data'
import MicrositeContactForm from '@/components/microsite/MicrositeContactForm'

// Public agency microsite: a branded page listing an agency's available
// properties + a contact form that drops a lead into the CRM. Reached at
// /a/<company domain>; portable to the agency's own domain later (a host rewrite
// can point yourdomain.com/ here). Only allowlisted, client-safe fields render.

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>

interface Brand { name: string; logoUrl: string | null; color: string }
interface Card { token: string; title: string; type: string; transaction: string; price: number; rent: number; district: string; city: string; beds: number; baths: number; size: number; photo: string | null }
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
  const { data: company } = await admin.from('Companies').select('*').eq('domain', slug).maybeSingle()
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
      photo: (p.photos ?? [])[0] ?? null,
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
    openGraph: { title: brand.name, description: `Properties from ${brand.name}`, images: cards[0]?.photo ? [cards[0].photo] : [] },
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

export default async function MicrositePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loaded = await loadSite(slug)
  if (!loaded) return <NotFound />
  const { brand, cards } = loaded.site
  const onAccent = readableOn(brand.color)

  return (
    <main className="min-h-screen pb-16" style={{ background: '#F4F5F7', fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
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
        {/* Listings grid */}
        {cards.length === 0 ? (
          <p className="text-sm text-center py-16" style={{ color: SUB }}>No available listings right now — check back soon.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {cards.map(card => {
              const price = card.transaction === 'For Rent' ? `${formatPrice(card.rent)}/mo` : formatPrice(card.price)
              return (
                <a key={card.token} href={`/l/${card.token}`} className="block rounded-2xl bg-white overflow-hidden transition-transform hover:-translate-y-0.5"
                  style={{ border: '1px solid #EEF0F4', boxShadow: '0 2px 10px rgba(20,34,63,0.06)' }}>
                  <div className="relative w-full" style={{ aspectRatio: '16 / 10', background: TYPE_GRADIENTS[card.type as keyof typeof TYPE_GRADIENTS] ?? '#E3E7EE' }}>
                    {card.photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.photo} alt={card.title} className="w-full h-full object-cover" />
                    )}
                    <span className="absolute top-2.5 left-2.5 text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }}>
                      {card.type} · {card.transaction}
                    </span>
                  </div>
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold truncate" style={{ color: H }}>{card.title}</p>
                      <p className="text-sm font-extrabold whitespace-nowrap" style={{ color: brand.color === '#14223F' ? '#1F7A4D' : brand.color }}>{price}</p>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: SUB }}>{card.district}, {card.city}</p>
                    <p className="text-xs mt-1.5" style={{ color: '#9AA3B2' }}>
                      {[card.beds > 0 ? `${card.beds} bd` : null, card.baths > 0 ? `${card.baths} ba` : null, card.size > 0 ? `${card.size} m²` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </a>
              )
            })}
          </div>
        )}

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
