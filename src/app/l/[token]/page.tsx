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

function Fact({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: accent + '0D' }}>
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

  const amenities = [
    listing.garden && 'Garden',
    listing.balcony && 'Balcony',
    listing.terrace && 'Terrace',
    listing.furnishing,
    ...listing.amenities,
    ...listing.buildingFeatures,
  ].filter(Boolean) as string[]

  // The agency's accent threads through the whole page; StateGen navy is the
  // fallback so an unbranded listing still looks intentional.
  const accent = brand?.color ?? '#14223F'
  const onAccent = readableOn(accent)

  return (
    <main className="min-h-screen md:py-8" style={{ background: '#EEF0F4', fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div className="max-w-2xl mx-auto bg-white overflow-hidden md:rounded-3xl" style={{ boxShadow: '0 12px 44px rgba(20,34,63,0.12)' }}>
        {/* Agency header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ background: accent }}>
          <div className="flex items-center gap-3 min-w-0">
            {brand?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={agency} className="h-12 w-auto max-w-[220px] object-contain shrink-0" style={{ borderRadius: 6 }} />
            )}
            <span className="font-extrabold tracking-tight truncate" style={{ color: onAccent, fontSize: brand?.logoUrl ? 16 : 19 }}>{agency}</span>
          </div>
          <span className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.14em] shrink-0" style={{ color: onAccent, opacity: 0.72 }}>
            Featured listing
          </span>
        </div>

        {/* Hero photo with overlaid title + price */}
        <div className="relative w-full" style={{ aspectRatio: '16 / 10', background: '#E3E7EE' }}>
          {listing.photos[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={listing.photos[0]} alt={listing.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: '#9AA3B2' }}>No photo</div>}

          {/* darkening scrim so the overlaid text stays legible on any photo */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(9,16,32,0.85) 0%, rgba(9,16,32,0.35) 34%, rgba(9,16,32,0) 62%)' }} />

          {/* top badges */}
          <div className="absolute top-3 left-3 flex gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(4px)' }}>
              {listing.type} · {listing.transaction}
            </span>
            {listing.status !== 'Available' && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(162,52,52,0.9)' }}>
                {listing.status}
              </span>
            )}
          </div>

          {/* bottom overlay: title, location, price pill */}
          <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl md:text-3xl font-extrabold text-white leading-tight" style={{ letterSpacing: '-0.5px', textShadow: '0 2px 16px rgba(0,0,0,0.35)' }}>
                  {listing.title}
                </h1>
                <p className="text-sm mt-1 text-white" style={{ opacity: 0.88 }}>{listing.district}, {listing.city}</p>
              </div>
              <span className="shrink-0 text-sm md:text-lg font-extrabold px-3.5 py-2 rounded-2xl whitespace-nowrap"
                style={{ background: accent, color: onAccent, boxShadow: '0 6px 18px rgba(0,0,0,0.28)' }}>
                {price}
              </span>
            </div>
          </div>
        </div>

        {/* Thumbnail strip */}
        {listing.photos.length > 1 && (
          <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ borderBottom: `1px solid ${LINE}` }}>
            {listing.photos.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: 92, height: 66 }} />
            ))}
          </div>
        )}

        <div className="p-5 md:p-6 space-y-6">
          {/* Facts */}
          {facts.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {facts.map(f => <Fact key={f.label} {...f} accent={accent} />)}
            </div>
          )}

          {/* Amenities */}
          {amenities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {amenities.map(a => (
                <span key={a} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: accent + '14', color: accent }}>{a}</span>
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <div className="flex items-center gap-2.5 mb-2.5">
              <span className="h-4 w-1 rounded-full" style={{ background: accent }} />
              <p className="text-[11px] font-bold uppercase" style={{ color: accent, letterSpacing: '0.12em' }}>About this property</p>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: '#2B3A54', whiteSpace: 'pre-wrap' }}>{listing.description}</p>
          </div>
        </div>

        {/* Contact card */}
        <div className="px-5 pb-6">
          <div className="rounded-2xl p-6 text-center" style={{ background: accent + '0F', border: `1px solid ${accent}22` }}>
            {brand?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="h-11 w-auto max-w-[200px] object-contain mx-auto mb-3" />
            )}
            <p className="text-base font-bold" style={{ color: H }}>Interested in this property?</p>
            <p className="text-sm mt-1" style={{ color: SUB }}>Reply to the agent who shared this listing to arrange a viewing.</p>
            <p className="text-[11px] mt-4 font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Presented by {agency}</p>
          </div>
        </div>
      </div>
    </main>
  )
}
