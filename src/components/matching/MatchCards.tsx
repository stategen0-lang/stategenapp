'use client'

import { useEffect, useState, useCallback } from 'react'
import { MessageCircle, ExternalLink, X, RefreshCw } from 'lucide-react'
import {
  PROPERTIES, CLIENTS, getAgent,
  Property, Client,
  formatPrice, TYPE_GRADIENTS,
} from '@/lib/data'

// ── Scoring formula (spec-compliant) ─────────────────────────────────────────

// Zones: same zone = 60. Adjacent zones (e.g. Beirut ↔ Metn) = 35. Never 0 for nearby.
const ZONES: Record<string, string[]> = {
  beirut:   ['hamra', 'raouche', 'raouché', 'ashrafieh', 'achrafieh', 'gemmayzeh', 'verdun',
             'mar mikhael', 'monot', 'badaro', 'koraytem', 'mazraa', 'jnah', 'sanayeh',
             'sodeco', 'furn el chebbak', 'sin el fil', 'bourj hammoud', 'dekwaneh'],
  metn:     ['naccache', 'dbayeh', 'antelias', 'zalka', 'jal el dib', 'beit mery', 'broumana',
             'mtayleb', 'baabda', 'mansourieh', 'biyada', 'bikfaya', 'ain saade', 'rabieh'],
  keserwan: ['jounieh', 'kaslik', 'ghazir', 'zouk', 'adma', 'tabarja', 'jbeil', 'byblos'],
  chouf:    ['aley', 'bhamdoun', 'barouk', 'deir el qamar', 'damour'],
  north:    ['tripoli', 'zgharta', 'bcharre', 'koura', 'batroun', 'jbeil'],
  south:    ['sidon', 'saida', 'tyre', 'sour', 'nabatieh'],
  bekaa:    ['zahle', 'chtaura', 'baalbek', 'anjar'],
}

// Neighbouring zone pairs — score 35 instead of 0
const NEIGHBOURS: [string, string][] = [
  ['beirut', 'metn'],
  ['beirut', 'chouf'],
  ['metn',   'keserwan'],
  ['metn',   'chouf'],
]

function norm(s: string) { return s.toLowerCase().trim() }

function propFeatures(p: Property): string[] {
  const out: string[] = []
  if (p.garden)  out.push('garden')
  if (p.balcony) out.push('balcony')
  if (p.view && p.view !== 'Street') out.push(`${p.view.toLowerCase()} view`)
  return out
}

function scoreBudget(propPrice: number, clientBudget: number): number {
  if (!clientBudget) return 100
  if (clientBudget >= propPrice) return 100
  const gap = (propPrice - clientBudget) / propPrice
  return gap > 0.15 ? 0 : Math.round((1 - gap / 0.15) * 100)
}

function scoreLocation(propLoc: string, clientLoc: string): number {
  if (!clientLoc) return 100
  const p = norm(propLoc); const c = norm(clientLoc)
  if (p.includes(c) || c.includes(p)) return 100

  // Find which zone each location belongs to
  const pZone = Object.entries(ZONES).find(([, areas]) => areas.some(a => p.includes(a)))?.[0]
  const cZone = Object.entries(ZONES).find(([, areas]) => areas.some(a => c.includes(a)))?.[0]

  // Same zone but different district → 60
  if (pZone && cZone && pZone === cZone) return 60

  // Neighbouring zones → 35
  if (pZone && cZone && NEIGHBOURS.some(([a, b]) => (a === pZone && b === cZone) || (b === pZone && a === cZone))) return 35

  // Different zones but both identified → still 15 (not 0) — they're at least in Lebanon
  if (pZone && cZone) return 15

  return 0
}

function scoreBedrooms(propBeds: number, clientBeds: number): number {
  if (!clientBeds) return 100
  const d = Math.abs(propBeds - clientBeds)
  return d === 0 ? 100 : d === 1 ? 80 : d === 2 ? 40 : 0
}

function scoreAmenities(features: string[], wishlist: string[]): number {
  if (!wishlist.length) return 100
  const matched = wishlist.filter(w => features.some(a => norm(a).includes(norm(w)) || norm(w).includes(norm(a))))
  return Math.round((matched.length / wishlist.length) * 100)
}

interface ScoreResult {
  total: number
  budgetScore: number
  locationScore: number
  typeScore: number
  bedroomScore: number
  amenityScore: number
}

function computeScore(prop: Property, client: Client): ScoreResult {
  const price    = prop.transaction === 'For Rent' ? prop.rent * 12 : prop.price
  const features = propFeatures(prop)
  const wish: string[] = [
    ...(client.req.garden  ? ['garden']  : []),
    ...(client.req.balcony ? ['balcony'] : []),
  ]
  const b  = scoreBudget(price, client.req.priceMax || client.budget)
  const l  = scoreLocation(`${prop.district} ${prop.city}`, client.req.location)
  const t  = !client.req.type || prop.type === client.req.type ? 100 : 0
  const br = scoreBedrooms(prop.beds, client.req.beds)
  const a  = scoreAmenities(features, wish)
  const total = (b * 0.40) + (l * 0.25) + (t * 0.15) + (br * 0.12) + (a * 0.08)
  return { total: Math.round(total * 100) / 100, budgetScore: b, locationScore: l, typeScore: t, bedroomScore: br, amenityScore: a }
}

// ── Score ring SVG ────────────────────────────────────────────────────────────
const CIRC = 113

function ScoreRing({ score }: { score: number }) {
  const color  = score >= 75 ? '#1D9E75' : '#BA7517'
  const offset = CIRC - (score / 100) * CIRC
  const label  = score >= 75 ? 'Strong' : 'Potential'
  return (
    <div className="flex flex-col items-center shrink-0">
      <div className="relative" style={{ width: 44, height: 44 }}>
        <svg width={44} height={44} viewBox="0 0 44 44">
          <circle cx={22} cy={22} r={18} fill="none" stroke="#EEF0F4" strokeWidth={4} />
          <circle
            cx={22} cy={22} r={18} fill="none"
            stroke={color} strokeWidth={4}
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>
          {Math.round(score)}
        </span>
      </div>
      <span className="text-xs font-semibold mt-0.5" style={{ color }}>{label}</span>
    </div>
  )
}

// ── Amenity overlap pills ─────────────────────────────────────────────────────
function AmenityPills({ features, wishlist }: { features: string[]; wishlist: string[] }) {
  const show = wishlist.length > 0 ? wishlist : features.slice(0, 4)
  if (!show.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {show.map(w => {
        const has = features.some(a => norm(a).includes(norm(w)) || norm(w).includes(norm(a)))
        return (
          <span key={w} className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: has ? '#E3F4EA' : '#FBE7E7', color: has ? '#1F7A4D' : '#A23434' }}>
            {has ? '✓' : '✗'} {w}
          </span>
        )
      })}
    </div>
  )
}

// ── Sub-score breakdown row ───────────────────────────────────────────────────
function SubScores({ s }: { s: ScoreResult }) {
  const items = [
    { label: 'Budget',   value: s.budgetScore   },
    { label: 'Location', value: s.locationScore  },
    { label: 'Type',     value: s.typeScore      },
    { label: 'Beds',     value: s.bedroomScore   },
  ]
  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {items.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-1">
          <span className="text-xs" style={{ color: '#9AA3B2' }}>{label}</span>
          <span className="text-xs font-bold" style={{ color: value >= 75 ? '#1D9E75' : value >= 50 ? '#BA7517' : '#A23434' }}>
            {Math.round(value)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Match card shell ──────────────────────────────────────────────────────────
function MatchCard({ score, onDismiss, children }: { score: number; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="relative flex items-start gap-3 p-3 rounded-xl mb-3 transition-all"
      style={{
        border:     score >= 75 ? '1.5px solid #B5DFC8' : '1.5px solid #F0DEB5',
        background: score >= 75 ? '#F4FCF8'             : '#FFFAF0',
      }}>
      {children}
      <button onClick={onDismiss} title="Dismiss match"
        className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors"
        style={{ color: '#C4CAD6' }}>
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function ActionBtn({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors hover:opacity-80"
      style={{ background: color + '1A', color }}>
      {icon} {label}
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type MatchEntity = 'property' | 'client'

interface Props {
  entityType: MatchEntity
  entityId: number
  onOpenProperty?: (p: Property) => void
  onOpenClient?: (c: Client) => void
}

interface MatchedClient   { client: Client;    score: ScoreResult }
interface MatchedProperty { property: Property; score: ScoreResult }

// ── Main component ─────────────────────────────────────────────────────────────
export default function MatchCards({ entityType, entityId, onOpenProperty, onOpenClient }: Props) {
  const [matchedClients,    setMatchedClients]    = useState<MatchedClient[]>([])
  const [matchedProperties, setMatchedProperties] = useState<MatchedProperty[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [loading,   setLoading]   = useState(true)

  const runMatching = useCallback(() => {
    setLoading(true)
    setTimeout(() => {
      if (entityType === 'property') {
        const prop = PROPERTIES.find(p => p.id === entityId)
        if (!prop) { setLoading(false); return }
        const results: MatchedClient[] = CLIENTS
          .map(c => ({ client: c, score: computeScore(prop, c) }))
          .filter(r => r.score.total >= 50)
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
        setMatchedClients(results)
        setDismissed(new Set())
      } else {
        const client = CLIENTS.find(c => c.id === entityId)
        if (!client) { setLoading(false); return }
        const results: MatchedProperty[] = PROPERTIES
          .filter(p => p.status !== 'Sold')
          .map(p => ({ property: p, score: computeScore(p, client) }))
          .filter(r => r.score.total >= 50)
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
        setMatchedProperties(results)
        setDismissed(new Set())
      }
      setLoading(false)
    }, 300)
  }, [entityType, entityId])

  useEffect(() => { runMatching() }, [runMatching])

  const visibleClientMatches = matchedClients.filter(r => !dismissed.has(r.client.id))
  const visiblePropMatches   = matchedProperties.filter(r => !dismissed.has(r.property.id))
  const count = entityType === 'property' ? visibleClientMatches.length : visiblePropMatches.length
  const label = entityType === 'property' ? 'Matched clients' : 'Matched properties'

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold" style={{ color: '#1A2B4A' }}>{label}</p>
          {!loading && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#EAF0FA', color: '#2E5288' }}>
              {count}
            </span>
          )}
        </div>
        <button onClick={runMatching}
          className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: '#7A8499' }}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Re-match
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: '#5E8FD6', borderTopColor: 'transparent' }} />
          <span className="text-xs ml-2.5" style={{ color: '#7A8499' }}>Running matching algorithm…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && count === 0 && (
        <p className="text-xs py-6 text-center" style={{ color: '#9AA3B2' }}>
          No matches found yet — matching runs automatically when records are added.
        </p>
      )}

      {/* ── Property → Client cards ── */}
      {!loading && entityType === 'property' && visibleClientMatches.map(({ client: c, score: s }) => {
        const agent    = getAgent(c.agentId)
        const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        const prop     = PROPERTIES.find(p => p.id === entityId)!
        const features = propFeatures(prop)
        const wishlist = [...(c.req.garden ? ['garden'] : []), ...(c.req.balcony ? ['balcony'] : [])]
        const waMsg    = encodeURIComponent(`Hi, I have a property match for your client ${c.name} — score ${Math.round(s.total)}%. Interested?`)
        return (
          <MatchCard key={c.id} score={s.total} onDismiss={() => setDismissed(prev => new Set([...prev, c.id]))}>
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: agent.color }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#1A2B4A' }}>{c.name}</p>
              <p className="text-xs" style={{ color: '#7A8499' }}>
                Budget {formatPrice(c.budget)} · {c.req.type || 'Any type'} · {c.req.location || 'Any area'}
              </p>
              <AmenityPills features={features} wishlist={wishlist} />
              <SubScores s={s} />
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <ScoreRing score={s.total} />
              <div className="flex gap-1.5">
                <ActionBtn icon={<ExternalLink className="h-3.5 w-3.5" />} label="View" color="#5E8FD6"
                  onClick={() => onOpenClient?.(c)} />
                <ActionBtn icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp" color="#1D9E75"
                  onClick={() => window.open(`https://wa.me/?text=${waMsg}`, '_blank')} />
              </div>
            </div>
          </MatchCard>
        )
      })}

      {/* ── Client → Property cards ── */}
      {!loading && entityType === 'client' && visiblePropMatches.map(({ property: p, score: s }) => {
        const photos   = p.photos ?? []
        const client   = CLIENTS.find(c => c.id === entityId)!
        const features = propFeatures(p)
        const wishlist = [...(client.req.garden ? ['garden'] : []), ...(client.req.balcony ? ['balcony'] : [])]
        const waMsg    = encodeURIComponent(`Hi, I found a property match — ${p.title} in ${p.district}, ${p.city}. Score: ${Math.round(s.total)}%. Interested?`)
        return (
          <MatchCard key={p.id} score={s.total} onDismiss={() => setDismissed(prev => new Set([...prev, p.id]))}>
            {photos[0]
              ? <img src={photos[0]} alt={p.title} className="w-14 h-10 rounded-lg object-cover shrink-0" />
              : <div className="w-14 h-10 rounded-lg shrink-0" style={{ background: TYPE_GRADIENTS[p.type] }} />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#1A2B4A' }}>{p.title}</p>
              <p className="text-xs" style={{ color: '#7A8499' }}>
                {formatPrice(p.transaction === 'For Rent' ? p.rent : p.price)}{p.transaction === 'For Rent' ? '/mo' : ''} · {p.type} · {p.district}, {p.city}
                {p.beds > 0 ? ` · ${p.beds}bd` : ''}
              </p>
              <AmenityPills features={features} wishlist={wishlist} />
              <SubScores s={s} />
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <ScoreRing score={s.total} />
              <div className="flex gap-1.5">
                <ActionBtn icon={<ExternalLink className="h-3.5 w-3.5" />} label="View" color="#5E8FD6"
                  onClick={() => onOpenProperty?.(p)} />
                <ActionBtn icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp" color="#1D9E75"
                  onClick={() => window.open(`https://wa.me/?text=${waMsg}`, '_blank')} />
              </div>
            </div>
          </MatchCard>
        )
      })}
    </div>
  )
}
