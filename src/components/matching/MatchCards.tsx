'use client'

import { useEffect, useState, useCallback } from 'react'
import { MessageCircle, ExternalLink, X, RefreshCw, Share2 } from 'lucide-react'
import {
  PROPERTIES, CLIENTS, getAgent,
  Property, Client,
  formatPrice, TYPE_GRADIENTS,
} from '@/lib/data'
import { propFeatures, matchClients, matchProperties, ScoreResult } from '@/lib/matching'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'

function norm(s: string) { return (s ?? '').toLowerCase().trim() }

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
    <div className="relative p-3 rounded-xl mb-3 transition-all"
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
  entity: Property | Client
  onOpenProperty?: (p: Property) => void
  onOpenClient?: (c: Client) => void
}

interface MatchedClient   { client: Client;    score: ScoreResult }
interface MatchedProperty { property: Property; score: ScoreResult }

// ── Main component ─────────────────────────────────────────────────────────────
export default function MatchCards({ entityType, entity, onOpenProperty, onOpenClient }: Props) {
  const [matchedClients,    setMatchedClients]    = useState<MatchedClient[]>([])
  const [matchedProperties, setMatchedProperties] = useState<MatchedProperty[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [loading,   setLoading]   = useState(true)
  const [busyKey,   setBusyKey]   = useState<number | null>(null)   // card minting a link
  const [copiedKey, setCopiedKey] = useState<number | null>(null)   // card that just copied

  // Mint the public /l/<token> link for a listing (empty string on failure —
  // we'd rather share/forward without it than block the agent).
  async function mintLink(propertyId: number): Promise<string> {
    try {
      const r = await fetch(`/api/share?id=${propertyId}`)
      if (r.ok) return (await r.json()).url ?? ''
    } catch { /* fall through */ }
    return ''
  }

  // Regular share: native sheet on mobile, copy-to-clipboard on desktop.
  async function shareListing(propertyId: number, title: string, cardKey: number) {
    setBusyKey(cardKey)
    const url = await mintLink(propertyId)
    setBusyKey(null)
    if (!url) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title, text: title, url }); return } catch { /* cancelled → copy */ }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopiedKey(cardKey)
      setTimeout(() => setCopiedKey(k => (k === cardKey ? null : k)), 2000)
    } catch { /* clipboard blocked — nothing to do */ }
  }

  // Forward a listing to a specific client from the AGENT'S OWN WhatsApp (the bot
  // never messages clients — see the client-contact product rule).
  async function forwardToClient(propertyId: number, title: string, phone: string, clientName: string, cardKey: number) {
    setBusyKey(cardKey)
    const url = await mintLink(propertyId)
    setBusyKey(null)
    const first = clientName.split(' ')[0]
    const msg = `Hi ${first}, I found a listing that might suit you — ${title}.${url ? `\n${url}` : ''}`
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const runMatching = useCallback(async () => {
    setLoading(true)
    try {
      if (entityType === 'property') {
        const prop = entity as Property
        // Match against the agency's real clients (fall back to demo data offline).
        let pool: Client[] = CLIENTS
        try {
          const res = await fetch('/api/clients')
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data.clients)) pool = data.clients.map(dbRowToClient)
          }
        } catch { /* keep demo fallback */ }
        setMatchedClients(matchClients(prop, pool).slice(0, 10))
      } else {
        const client = entity as Client
        // Match against the agency's real listings (fall back to demo data offline).
        let pool: Property[] = PROPERTIES
        try {
          const res = await fetch('/api/properties')
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data.properties)) pool = data.properties.map(dbRowToProperty)
          }
        } catch { /* keep demo fallback */ }
        setMatchedProperties(matchProperties(client, pool).slice(0, 10))
      }
      setDismissed(new Set())
    } finally {
      setLoading(false)
    }
  }, [entityType, entity])

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
        const prop     = entity as Property
        const features = propFeatures(prop)
        const wishlist = [...(c.req.garden ? ['garden'] : []), ...(c.req.balcony ? ['balcony'] : [])]
        const first    = c.name.split(' ')[0]
        return (
          <MatchCard key={c.id} score={s.total} onDismiss={() => setDismissed(prev => new Set([...prev, c.id]))}>
            <div className="flex items-start gap-3 pr-5">
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
              <ScoreRing score={s.total} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <ActionBtn icon={<ExternalLink className="h-3.5 w-3.5" />} label="View" color="#5E8FD6"
                onClick={() => onOpenClient?.(c)} />
              {c.phone && !c.masked && (
                <ActionBtn icon={<MessageCircle className="h-3.5 w-3.5" />} label={`Forward to ${first}`} color="#1D9E75"
                  onClick={() => forwardToClient(prop.id, prop.title, c.phone, c.name, c.id)} />
              )}
              <ActionBtn icon={<Share2 className="h-3.5 w-3.5" />}
                label={copiedKey === c.id ? 'Copied ✓' : busyKey === c.id ? '…' : 'Share'} color="#7A8499"
                onClick={() => shareListing(prop.id, prop.title, c.id)} />
            </div>
          </MatchCard>
        )
      })}

      {/* ── Client → Property cards ── */}
      {!loading && entityType === 'client' && visiblePropMatches.map(({ property: p, score: s }) => {
        const photos   = p.photos ?? []
        const client   = entity as Client
        const features = propFeatures(p)
        const wishlist = [...(client.req.garden ? ['garden'] : []), ...(client.req.balcony ? ['balcony'] : [])]
        const first    = client.name.split(' ')[0]
        return (
          <MatchCard key={p.id} score={s.total} onDismiss={() => setDismissed(prev => new Set([...prev, p.id]))}>
            <div className="flex items-start gap-3 pr-5">
              {photos[0]
                ? // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[0]} alt={p.title} className="w-14 h-10 rounded-lg object-cover shrink-0" />
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
              <ScoreRing score={s.total} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <ActionBtn icon={<ExternalLink className="h-3.5 w-3.5" />} label="View" color="#5E8FD6"
                onClick={() => onOpenProperty?.(p)} />
              {client.phone && !client.masked && (
                <ActionBtn icon={<MessageCircle className="h-3.5 w-3.5" />} label={`Forward to ${first}`} color="#1D9E75"
                  onClick={() => forwardToClient(p.id, p.title, client.phone, client.name, p.id)} />
              )}
              <ActionBtn icon={<Share2 className="h-3.5 w-3.5" />}
                label={copiedKey === p.id ? 'Copied ✓' : busyKey === p.id ? '…' : 'Share'} color="#7A8499"
                onClick={() => shareListing(p.id, p.title, p.id)} />
            </div>
          </MatchCard>
        )
      })}
    </div>
  )
}
