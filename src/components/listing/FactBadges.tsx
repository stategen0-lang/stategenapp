import type { LucideIcon } from 'lucide-react'
import { Maximize2, BedDouble, Bath, SquareParking, Eye, Waves, Mountain, Sun, Fence, Trees } from 'lucide-react'

// A listing's key facts as small icon badges, in the order people scan them:
// area, bedrooms, bathrooms, parking, view, then outdoor space. Shared by the
// app's property cards and the agency's public catalog so the two never drift.
// Only client-safe fields — nothing here is private to the agency.

export interface FactSource {
  size?: number
  beds?: number
  baths?: number
  parkings?: number
  view?: string
  terrace?: boolean
  balcony?: boolean
  garden?: boolean
}

interface Fact { key: string; label: string; title: string; Icon: LucideIcon; tone: 'plain' | 'blue' | 'green' }

/** The badges, in display order. Empty facts are left out. */
export function listingFacts(p: FactSource): Fact[] {
  const out: Fact[] = []
  if ((p.size ?? 0) > 0) out.push({ key: 'size', label: `${p.size} m²`, title: 'Area', Icon: Maximize2, tone: 'plain' })
  if ((p.beds ?? 0) > 0) out.push({ key: 'beds', label: `${p.beds} bed`, title: 'Bedrooms', Icon: BedDouble, tone: 'plain' })
  if ((p.baths ?? 0) > 0) out.push({ key: 'baths', label: `${p.baths} bath`, title: 'Bathrooms', Icon: Bath, tone: 'plain' })
  if ((p.parkings ?? 0) > 0) out.push({ key: 'parking', label: `${p.parkings} parking`, title: 'Parking spaces', Icon: SquareParking, tone: 'plain' })
  if (p.view && p.view.trim()) {
    const v = p.view.toLowerCase()
    const Icon = /sea|river|lake/.test(v) ? Waves : /mountain|valley|forest/.test(v) ? Mountain : Eye
    out.push({ key: 'view', label: p.view, title: `${p.view} view`, Icon, tone: 'plain' })
  }
  if (p.terrace) out.push({ key: 'terrace', label: 'Terrace', title: 'Terrace', Icon: Sun, tone: 'blue' })
  if (p.balcony) out.push({ key: 'balcony', label: 'Balcony', title: 'Balcony', Icon: Fence, tone: 'blue' })
  if (p.garden) out.push({ key: 'garden', label: 'Garden', title: 'Garden', Icon: Trees, tone: 'green' })
  return out
}

const TONES = {
  plain: { background: '#F0F2F5', color: '#6A7488' },
  blue: { background: '#EAF0FA', color: '#2E5288' },
  green: { background: '#E3F4EA', color: '#1F7A4D' },
} as const

export default function FactBadges({ listing, className = '' }: { listing: FactSource; className?: string }) {
  const facts = listingFacts(listing)
  if (!facts.length) return null
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {facts.map(f => (
        <span key={f.key} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={TONES[f.tone]} title={f.title}>
          <f.Icon className="h-3 w-3 shrink-0" aria-hidden />
          {f.label}
        </span>
      ))}
    </div>
  )
}
