'use client'

import { useState, useRef } from 'react'
import { MessageCircle, Link2, MapPin, FileText, Phone } from 'lucide-react'
import { Property, Agent, Client, TYPE_GRADIENTS, statusStyle, formatPrice, buildDesc, getAgent, propertyLocation } from '@/lib/data'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { usePullToClose } from '@/hooks/use-pull-to-close'
import MatchCards from '@/components/matching/MatchCards'
import OffersSection from '@/components/offers/OffersSection'
import ClientDetailModal from './ClientDetailModal'
import PhotoGallery from '@/components/listing/PhotoGallery'
import { hasField, type ListingField } from '@/lib/property-fields'
import { SendToMarketingButton } from '@/components/marketing/SendToMarketing'

interface Props {
  property: Property
  agent: Agent
  onClose: () => void
  onEdit?: (p: Property) => void
  /** WhatsApp number of the listing's agent (E.164), when they're reachable. */
  agentWhatsApp?: string | null
  /** True when the viewer is the listing's own agent — no "contact yourself". */
  isOwnListing?: boolean
}

export default function PropertyDetailModal({ property: p, agent, onClose, onEdit, agentWhatsApp, isOwnListing }: Props) {
  useLockBodyScroll()
  // Pull down at the top of the sheet to go back to the list — the mobile
  // gesture equivalent of tapping ✕.
  const { scrollRef: pullScrollRef, panelRef: pullPanelRef, pulling, progress } = usePullToClose(onClose)
  const sc = statusStyle(p.status)
  const photos = p.photos ?? []
  // Which facts this kind of listing has at all.
  const has = (field: ListingField) => hasField(p.type, field)
  const [stackedClient, setStackedClient] = useState<Client | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareUrlRef = useRef<string | null>(null)

  // Mint the signed public link once (the token is signed with a server secret,
  // so it can't be built client-side) and cache it for this session.
  async function getShareUrl(): Promise<string | null> {
    if (shareUrlRef.current) return shareUrlRef.current
    setShareBusy(true)
    try {
      const res = await fetch(`/api/share?id=${p.id}`)
      if (!res.ok) return null
      const { url } = await res.json()
      shareUrlRef.current = url as string
      return url as string
    } catch {
      return null
    } finally {
      setShareBusy(false)
    }
  }

  const shareText = () => {
    const price = p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)
    const where = [p.district, p.city].filter(Boolean).join(', ')
    return `${p.title}${where ? ` — ${where}` : ''} · ${price}`
  }

  async function onShareClick() {
    const url = await getShareUrl()
    if (!url) { setCopied(false); return }
    // Mobile: the native share sheet already includes WhatsApp, Copy, etc.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: p.title, text: shareText(), url }); return } catch { /* cancelled → fall to menu */ }
    }
    setShareOpen(o => !o)
  }

  async function shareWhatsApp() {
    const url = await getShareUrl()
    if (!url) return
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText()}\n${url}`)}`, '_blank')
    setShareOpen(false)
  }

  async function copyLink() {
    const url = await getShareUrl()
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { window.prompt('Copy this listing link:', url) }
    setShareOpen(false)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
        style={{ background: 'rgba(14,31,61,0.5)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div
          ref={pullPanelRef}
          className="w-full md:max-w-lg md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col relative"
          style={{ background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.2)', maxHeight: '92vh' }}
        >
          {/* Pull-to-close hint — fades in as the sheet is dragged down, only relevant on mobile */}
          <div
            className="md:hidden absolute left-0 right-0 flex justify-center pointer-events-none z-10"
            style={{ top: 8, opacity: pulling ? progress : 0, transition: pulling ? 'none' : 'opacity 0.2s ease' }}
          >
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(14,31,61,0.85)', color: '#fff' }}>
              {progress >= 1 ? 'Release to go back' : '↓ Pull to go back'}
            </span>
          </div>
          {/* ── Photos ──
              The same gallery as the public listing page: swipe or scroll
              sideways through the photos, thumbnails scroll with them, and the
              listing's title sits on the first photo only so the rest are
              shown clean. lockVerticalScroll keeps a swipe here from scrolling
              the list behind the sheet. */}
          <div className="shrink-0">
            <PhotoGallery
              photos={photos}
              title={p.title}
              frameStyle={{ height: 200 }}
              thumb={{ w: 56, h: 40 }}
              stripClassName="px-4 py-2"
              stripStyle={{ borderBottom: '1px solid #EEF0F4', background: '#F7F8FB' }}
              counterClassName="bottom-3 right-3"
              lockVerticalScroll
              empty={<div className="w-full h-full" style={{ background: TYPE_GRADIENTS[p.type] ?? 'linear-gradient(135deg,#16294A,#2E5288)' }} />}
              overlay={
                <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={onShareClick}
                      className="h-7 px-3 rounded-full flex items-center justify-center text-white text-xs font-semibold leading-none"
                      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                    >
                      {shareBusy ? '…' : copied ? 'Copied ✓' : 'Share'}
                    </button>
                    {shareOpen && (
                      <>
                        {/* click-away to close */}
                        <div className="fixed inset-0 z-10" onClick={() => setShareOpen(false)} />
                        <div className="absolute right-0 mt-1 z-20 rounded-xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,0.22)', minWidth: 180 }}>
                          <button onClick={shareWhatsApp} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium hover:bg-gray-50" style={{ color: '#14223F' }}>
                            <MessageCircle className="h-4 w-4" style={{ color: '#25D366' }} /> Share on WhatsApp
                          </button>
                          <button onClick={copyLink} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium hover:bg-gray-50" style={{ color: '#14223F', borderTop: '1px solid #EEF0F4' }}>
                            <Link2 className="h-4 w-4" style={{ color: '#5E8FD6' }} /> Copy link
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {onEdit && (
                    <button
                      onClick={() => onEdit(p)}
                      className="h-7 px-3 rounded-full flex items-center justify-center text-white text-xs font-semibold leading-none"
                      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm leading-none"
                    style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
                  >
                    ✕
                  </button>
                </div>
              }
            >
              <span
                className="absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(0,0,0,0.35)', color: '#fff', backdropFilter: 'blur(4px)' }}
              >
                {p.type} · {p.transaction}
              </span>
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3">
                <p className="text-base font-bold text-white leading-tight">{p.title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {propertyLocation(p)}
                </p>
              </div>
            </PhotoGallery>
          </div>

          {photos.length === 0 && (
            <div className="flex gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid #EEF0F4', background: '#F7F8FB' }}>
              <p className="text-xs italic" style={{ color: '#9AA3B2' }}>No photos uploaded yet</p>
            </div>
          )}

          {/* ── Scrollable body ── */}
          <div ref={pullScrollRef} className="overflow-y-auto flex-1 p-5 space-y-4" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center justify-between">
              <p className="text-2xl font-extrabold" style={{ color: '#14223F', letterSpacing: '-0.5px' }}>
                {p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}
              </p>
              <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                {p.status}
              </span>
            </div>

            {/* pre-wrap: template descriptions are multi-line with headings and
                bullet lists, which would otherwise collapse into one paragraph */}
            <p className="text-sm leading-relaxed" style={{ color: '#6A7488', whiteSpace: 'pre-wrap' }}>{buildDesc(p)}</p>
            {/* The Arabic version, when one has been written. dir="rtl" is not
                cosmetic: without it the prices and "م²" land at the wrong end
                of the line. */}
            {p.aiDescriptionAr?.trim() && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid #EEF0F4' }}>
                <p
                  dir="rtl" lang="ar"
                  className="text-sm leading-relaxed"
                  style={{ color: '#6A7488', whiteSpace: 'pre-wrap', textAlign: 'right' }}
                >
                  {p.aiDescriptionAr.trim()}
                </p>
              </div>
            )}

            {/* Public Notes — the agent's own selling points. They were written
                into the form, worked into the description and shown on the
                share page, but there was nowhere to read them back on the
                listing itself, so an agent could not check what they had said.
                "Good to know" is the heading the share page gives them, kept
                the same so it is recognisably the same text.
                pre-wrap for the same reason as the description above. */}
            {p.publicNotes?.trim() && (
              <div className="rounded-xl p-3" style={{ background: '#F5F9FE', border: '1px solid #DCE8F7' }}>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: '#2E5288', letterSpacing: '0.08em' }}>
                  GOOD TO KNOW
                </p>
                <p className="text-sm leading-relaxed" style={{ color: '#2B3A54', whiteSpace: 'pre-wrap' }}>
                  {p.publicNotes.trim()}
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {[
                // Only the facts this kind of listing actually has. A plot
                // used to report "Bedrooms N/A, Garden No, Balcony No" under a
                // photograph of a field.
                ...(has('size') ? [{ label: 'Size', value: `${p.size} m²` }] : []),
                ...(has('beds') ? [{ label: 'Bedrooms', value: p.beds > 0 ? String(p.beds) : 'N/A' }] : []),
                ...(has('baths') ? [{ label: 'Bathrooms', value: String(p.baths) }] : []),
                ...(has('view') ? [{ label: 'View', value: p.view || '—' }] : []),
                ...(has('garden') ? [{ label: 'Garden', value: p.garden ? 'Yes' : 'No' }] : []),
                ...(has('balcony') ? [{ label: 'Balcony', value: p.balcony ? 'Yes' : 'No' }] : []),
                ...(p.terrace && has('terrace') ? [{ label: 'Terrace', value: 'Yes' }] : []),
                ...(p.furnishing && has('furnishing') ? [{ label: 'Furnishing', value: p.furnishing }] : []),
                ...(p.parkings && has('parkings') ? [{ label: 'Parking', value: String(p.parkings) }] : []),
                ...(p.buildingAge && has('buildingAge') ? [{ label: 'Building Age', value: `${p.buildingAge} yrs` }] : []),
                ...(p.floor && has('floor') ? [{ label: 'Floor', value: p.floor }] : []),
                ...(p.needsRenovation && has('needsRenovation') ? [{ label: 'Renovation', value: 'Needed' }] : []),
                ...(p.advancedPayment ? [{ label: 'Advanced pay', value: p.advancedPayment }] : []),
                ...(p.referredBy ? [{ label: 'Referred by', value: p.referredBy }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                  <p className="text-xs" style={{ color: '#9AA3B2' }}>{label}</p>
                  <p className="text-sm font-semibold mt-0.5" style={{ color: '#14223F' }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Amenities & building features */}
            {[...(p.amenities ?? []), ...(p.buildingFeatures ?? [])].length > 0 && (
              <div className="flex flex-wrap gap-2">
                {[...(p.amenities ?? []), ...(p.buildingFeatures ?? [])].map(f => (
                  <span key={f} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                    {f}
                  </span>
                ))}
              </div>
            )}

            {/* Video walkthrough */}
            {p.video && (
              <div className="rounded-xl overflow-hidden" style={{ background: '#000' }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={p.video} controls playsInline preload="metadata" className="w-full" style={{ maxHeight: 280 }} />
              </div>
            )}

            {/* Private — only reaches the owning agent + managers (the server
                strips these fields for everyone else, so their mere presence
                means the viewer is allowed to see them). */}
            {(p.ownerName || p.ownerContact || p.documentPath || p.mapUrl || p.notes?.trim()) && (
              <div className="rounded-xl p-3" style={{ background: '#FBF6EE', border: '1px solid #EFE2CC' }}>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: '#8A5A24' }}>🔒 Private — you & managers</p>
                {(p.ownerName || p.ownerContact) && (
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: '#14223F' }}>{p.ownerName || 'Owner'}</p>
                      {p.ownerContact && <p className="text-xs" style={{ color: '#6A7488' }}>{p.ownerContact}</p>}
                    </div>
                    {p.ownerContact && (
                      <div className="flex gap-1.5 shrink-0">
                        <a href={`tel:${p.ownerContact.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: '#2E5288' }}>
                          <Phone className="h-3 w-3" /> Call
                        </a>
                        <a href={`https://wa.me/${p.ownerContact.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: '#25D366' }}>
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      </div>
                    )}
                  </div>
                )}
                {/* Internal notes. They belong here and nowhere else: the server
                    now strips them for everyone but this listing's own agent and
                    the managers, so the heading above is the literal truth
                    rather than a hope — see stripPrivateFields. */}
                {p.notes?.trim() && (
                  <div className="mt-2 px-3 py-2 rounded-lg" style={{ background: '#fff', border: '1px solid #EFE2CC' }}>
                    <p className="text-[11px] font-bold mb-1" style={{ color: '#8A5A24', letterSpacing: '0.08em' }}>
                      INTERNAL NOTES
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: '#14223F', whiteSpace: 'pre-wrap' }}>
                      {p.notes.trim()}
                    </p>
                  </div>
                )}
                {p.mapUrl && (
                  <a
                    href={p.mapUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-sm font-medium"
                    style={{ background: '#fff', border: '1px solid #EFE2CC', color: '#14223F' }}
                  >
                    <MapPin className="h-4 w-4 shrink-0" style={{ color: '#2E5288' }} />
                    <span className="truncate flex-1">Open exact location</span>
                  </a>
                )}
                {p.documentPath && (
                  <a
                    href={`/api/properties/document?id=${p.id}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-sm font-medium"
                    style={{ background: '#fff', border: '1px solid #EFE2CC', color: '#14223F' }}
                  >
                    <FileText className="h-4 w-4 shrink-0" style={{ color: '#2E5288' }} />
                    <span className="truncate flex-1">{p.documentName || 'Open document'}</span>
                  </a>
                )}
              </div>
            )}

            {/* Hands the listing to the marketing team (lister + managers only). */}
            <SendToMarketingButton property={p} />

            <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid #EEF0F4' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ background: agent.color }}
              >
                {agent.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: '#14223F' }}>Listed by {agent.name}</p>
                <p className="text-xs" style={{ color: '#9AA3B2' }}>StateGen</p>
              </div>
              {!isOwnListing && agentWhatsApp && (
                <a
                  href={`https://wa.me/${agentWhatsApp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${agent.name}, about your listing "${p.title}" (#${p.id})`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white shrink-0"
                  style={{ background: '#25D366' }}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Message
                </a>
              )}
            </div>

            {/* ── Offers & negotiation ── */}
            <div style={{ borderTop: '1px solid #EEF0F4', paddingTop: 16 }}>
              <OffersSection propertyId={p.id} asking={p.transaction === 'For Rent' ? p.rent : p.price} />
            </div>

            {/* ── AI Matching ── */}
            <div style={{ borderTop: '1px solid #EEF0F4', paddingTop: 16 }}>
              <MatchCards
                entityType="property"
                entity={p}
                onOpenClient={c => setStackedClient(c)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stacked client modal — comes later in DOM so renders above at same z-index */}
      {stackedClient && (
        <ClientDetailModal
          client={stackedClient}
          agent={getAgent(stackedClient.agentId) ?? { id: stackedClient.agentId as Agent['id'], name: stackedClient.agentId, initials: stackedClient.agentId.slice(0,2).toUpperCase(), color: '#9AA3B2', shortName: stackedClient.agentId }}
          onClose={() => setStackedClient(null)}
        />
      )}
    </>
  )
}
