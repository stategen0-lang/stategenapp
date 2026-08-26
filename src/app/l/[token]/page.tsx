import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbRowToProperty } from '@/lib/db-mappers'
import { parseShareToken, shareSecret, publicListing, type PublicListing } from '@/lib/share'
import { formatPrice } from '@/lib/data'

// Public, unauthenticated listing page. Reached only via a signed token, and it
// renders exclusively the allowlisted fields from publicListing() — never the
// internal notes or owner contact stored on the property.

export const dynamic = 'force-dynamic'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

// The owning agency's public branding — shown instead of the generic StateGen
// footer so a shared link carries the agent's company.
interface Brand { name: string | null; logoUrl: string | null; color: string | null }
interface PageData { listing: PublicListing; brand: Brand | null }

async function loadPage(token: string): Promise<PageData | null> {
  const id = parseShareToken(token, shareSecret())
  if (id === null) return null

  const admin = createAdminClient()
  const { data } = await admin.from('Properties').select('*').eq('id', id).maybeSingle()
  if (!data) return null

  const row = data as Record<string, unknown>
  const p = dbRowToProperty(row, 0)
  const description = p.aiDescription?.trim() || fallbackDescription(p)
  const listing = publicListing(p, description)

  let brand: Brand | null = null
  const companyId = row.company_id
  if (companyId != null) {
    // select('*') so a missing migration 016 (logo_url/brand_color) degrades to
    // name-only rather than throwing on the public page.
    const { data: c } = await admin.from('Companies').select('*').eq('id', companyId).maybeSingle()
    if (c) {
      const cr = c as Record<string, unknown>
      brand = {
        name: (cr.Name as string) || null,
        logoUrl: (cr.logo_url as string) || null,
        color: (cr.brand_color as string) || null,
      }
    }
  }
  return { listing, brand }
}

// Dark or light text for a given accent background, so the agency name stays
// legible whatever colour they pick.
function readableOn(hex: string | null): string {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex) : null
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#14223F' : '#ffffff'
}

// A clean fallback when no marketing description was written. Deliberately omits
// the agent name and any internal detail — branding lives in the page footer.
function fallbackDescription(p: ReturnType<typeof dbRowToProperty>): string {
  const price = p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)
  const beds = p.beds > 0 ? ` with ${p.beds} bedroom${p.beds > 1 ? 's' : ''} and ${p.baths} bathroom${p.baths > 1 ? 's' : ''}` : ''
  const extras = [p.garden && 'a private garden', p.balcony && 'a balcony', p.view && `${p.view.toLowerCase()} views`]
    .filter(Boolean).join(', ')
  return `A ${p.size ? `${p.size} m² ` : ''}${p.type.toLowerCase()} in ${p.district}, ${p.city}${beds}, offered ${p.transaction.toLowerCase()} at ${price}.${extras ? ` Featuring ${extras}.` : ''}`
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const page = await loadPage(token)
  if (!page) return { title: 'Listing — StateGen' }
  const { listing, brand } = page
  const agency = brand?.name ?? 'StateGen'
  const price = listing.transaction === 'For Rent' ? `${formatPrice(listing.rent)}/mo` : formatPrice(listing.price)
  return {
    title: `${listing.title} — ${price} · ${agency}`,
    description: `${listing.type} ${listing.transaction.toLowerCase()} in ${listing.district}, ${listing.city}.`,
    openGraph: {
      title: `${listing.title} — ${price}`,
      description: `${listing.type} in ${listing.district}, ${listing.city}`,
      siteName: agency,
      images: listing.photos.length ? [listing.photos[0]] : [],
    },
  }
}

function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F7F8FB' }}>
      <div className="text-center max-w-sm">
        <p className="text-lg font-bold" style={{ color: H }}>Listing unavailable</p>
        <p className="text-sm mt-1.5" style={{ color: SUB }}>
          This link is invalid or the listing is no longer shared. Please ask the agent for an up-to-date link.
        </p>
        <p className="text-xs mt-6 font-semibold" style={{ color: '#9AA3B2' }}>Presented by StateGen</p>
      </div>
    </main>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: '#F7F8FB' }}>
      <p className="text-sm font-bold" style={{ color: H }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: SUB }}>{label}</p>
    </div>
  )
}

export default async function ListingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const page = await loadPage(token)
  if (!page) return <NotFound />
  const { listing, brand } = page
  const agency = brand?.name ?? 'StateGen'
  const branded = !!(brand && (brand.name || brand.logoUrl))

  const price = listing.transaction === 'For Rent' ? `${formatPrice(listing.rent)}/mo` : formatPrice(listing.price)
  const facts: { label: string; value: string }[] = [
    listing.beds > 0 ? { label: 'Bedrooms', value: String(listing.beds) } : null,
    listing.baths > 0 ? { label: 'Bathrooms', value: String(listing.baths) } : null,
    listing.size > 0 ? { label: 'Size', value: `${listing.size} m²` } : null,
    listing.parkings ? { label: 'Parking', value: String(listing.parkings) } : null,
    listing.view ? { label: 'View', value: listing.view } : null,
    listing.buildingAge ? { label: 'Building age', value: `${listing.buildingAge} yr` } : null,
  ].filter((f): f is { label: string; value: string } => f !== null)

  const amenities = [listing.garden && 'Garden', listing.balcony && 'Balcony'].filter(Boolean) as string[]

  return (
    <main className="min-h-screen pb-10" style={{ background: '#F7F8FB', fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="max-w-2xl mx-auto">
        {/* Agency branding bar */}
        {branded && (
          <div className="flex items-center gap-3 px-5 py-3" style={{ background: brand!.color ?? '#14223F' }}>
            {brand!.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand!.logoUrl} alt={agency} className="h-8 w-auto max-w-[170px] object-contain" style={{ borderRadius: 4 }} />
            )}
            {brand!.name && (
              <span className="text-sm font-bold tracking-tight" style={{ color: readableOn(brand!.color) }}>{brand!.name}</span>
            )}
          </div>
        )}

        {/* Hero photo */}
        <div className="relative w-full" style={{ aspectRatio: '16 / 10', background: '#E3E7EE' }}>
          {listing.photos[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={listing.photos[0]} alt={listing.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: '#9AA3B2' }}>No photo</div>}
          <div className="absolute top-3 left-3 flex gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
              {listing.type} · {listing.transaction}
            </span>
            {listing.status !== 'Available' && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(162,52,52,0.85)' }}>
                {listing.status}
              </span>
            )}
          </div>
        </div>

        {/* Thumbnail strip */}
        {listing.photos.length > 1 && (
          <div className="flex gap-2 px-4 py-3 overflow-x-auto bg-white" style={{ borderBottom: `1px solid ${LINE}` }}>
            {listing.photos.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="shrink-0 rounded-lg object-cover" style={{ width: 84, height: 60 }} />
            ))}
          </div>
        )}

        <div className="bg-white p-5 md:p-6 space-y-5">
          {/* Title + price */}
          <div>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h1 className="text-xl md:text-2xl font-extrabold" style={{ color: H, letterSpacing: '-0.4px' }}>{listing.title}</h1>
              <p className="text-xl md:text-2xl font-extrabold whitespace-nowrap" style={{ color: '#1F7A4D' }}>{price}</p>
            </div>
            <p className="text-sm mt-1" style={{ color: SUB }}>{listing.district}, {listing.city}</p>
          </div>

          {/* Facts */}
          {facts.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {facts.map(f => <Fact key={f.label} {...f} />)}
            </div>
          )}

          {/* Amenities */}
          {amenities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {amenities.map(a => (
                <span key={a} className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>{a}</span>
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <p className="text-xs font-bold mb-1.5" style={{ color: SUB, letterSpacing: '0.04em' }}>ABOUT THIS PROPERTY</p>
            <p className="text-sm leading-relaxed" style={{ color: '#2B3A54', whiteSpace: 'pre-wrap' }}>{listing.description}</p>
          </div>
        </div>

        {/* Agency footer */}
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-bold" style={{ color: H }}>Interested in this property?</p>
          <p className="text-xs mt-1" style={{ color: SUB }}>Reply to the agent who sent you this link to arrange a viewing.</p>
          <p className="text-xs mt-4 font-semibold" style={{ color: '#9AA3B2' }}>
            Presented by {agency}
          </p>
        </div>
      </div>
    </main>
  )
}
