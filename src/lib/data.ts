// Central mock data — StateGen CRM (Lebanese Real Estate Agency)

export type AgentId = 'a1' | 'a2' | 'a3' | 'a4'

export interface Agent {
  id: AgentId
  name: string
  initials: string
  color: string
  shortName: string
}

export const AGENTS: Agent[] = [
  { id: 'a1', name: 'Lara Khoury',     initials: 'LK', color: '#5E8FD6', shortName: 'Lara K.' },
  { id: 'a2', name: 'Rami Saad',       initials: 'RS', color: '#1F8A5B', shortName: 'Rami S.' },
  { id: 'a3', name: 'Sami Abi Nader',  initials: 'SN', color: '#9A6516', shortName: 'Sami A.' },
  { id: 'a4', name: 'Nour Haddad',     initials: 'NH', color: '#A23434', shortName: 'Nour H.' },
]

export type PropertyType =
  | 'Appartement' | 'Duplex' | 'Studio' | 'Villa' | 'Chalet' | 'Standalone'
  | 'Building' | 'Land' | 'Shop' | 'Office' | 'Showroom' | 'Restaurant'
  | 'Garage' | 'Warehouse'
export type Transaction = 'For Sale' | 'For Rent'
export type PropertyStatus = 'Available' | 'Pending' | 'Sold' | 'Reserved'
export type AdvancedPayment = '3 months' | '6 months' | '1 year'
export type Furnishing = 'Furnished' | 'Semi-furnished' | 'Unfurnished'
export const FURNISHINGS: Furnishing[] = ['Furnished', 'Semi-furnished', 'Unfurnished']
export type Floor = 'Ground level' | 'Mid floor' | 'Last floor'
export const FLOORS: Floor[] = ['Ground level', 'Mid floor', 'Last floor']

// Tick-box amenities stored as free arrays (so the list can grow without a
// migration). Garden/Balcony/Terrace keep their own booleans for backward
// compatibility and matching; these are the extras.
export const PROPERTY_AMENITIES = [
  'Pool', "Helper's Room", 'Air Conditioning', 'Credit Facilities',
]
export const BUILDING_FEATURES = [
  'Concierge', '24/7 Security', 'Elevator', 'Gym', 'Shared Pool',
  'Shared Spaces', 'Storage Room', 'Generator', 'Water Well', 'Solar Panels',
]

// The one canonical list of listing types, in the order shown in every picker.
// Kept here so the web modals, the client "looking for" picker and the microsite
// filter never drift apart. (The WhatsApp coercion whitelist in
// whatsapp/writes.ts is a separate, self-contained pure module — keep it in sync
// by hand when this changes.)
export const PROPERTY_TYPES: PropertyType[] = [
  'Appartement', 'Duplex', 'Studio', 'Villa', 'Chalet', 'Standalone',
  'Building', 'Land', 'Shop', 'Office', 'Showroom', 'Restaurant',
  'Garage', 'Warehouse',
]

// A friendlier label for the picker where the enum value alone is unclear.
const PROPERTY_TYPE_LABELS: Partial<Record<PropertyType, string>> = {
  Standalone: 'Standalone (House)',
}
export function propertyTypeLabel(t: PropertyType): string {
  return PROPERTY_TYPE_LABELS[t] ?? t
}

export interface Property {
  id: number
  title: string
  type: PropertyType
  transaction: Transaction
  price: number           // sale price or 0 if rent-only
  rent: number            // monthly rent or 0 if sale-only
  advancedPayment?: AdvancedPayment  // for rentals only
  photos?: string[]
  district: string
  city: string
  size: number            // m²
  beds: number
  baths: number
  garden: boolean
  balcony: boolean
  view: string
  parkings?: number
  buildingAge?: number
  floor?: Floor
  needsRenovation?: boolean
  terrace?: boolean
  amenities?: string[]
  buildingFeatures?: string[]
  furnishing?: Furnishing
  /** Google Maps link / pin to the exact spot. */
  mapUrl?: string
  /** A single walkthrough video, stored as a URL (upload or a pasted link). */
  video?: string
  aiDescription?: string
  notes?: string
  /** Partner company/agent who referred this listing (for co-brokering). Internal
   *  — visible to the team, never published to the public page. */
  referredBy?: string
  // Private to the assigned agent + managers — never shown to other agents or
  // published to the public microsite.
  ownerName?: string
  ownerContact?: string
  /** Storage path (private bucket) of an attached document, not a public URL. */
  documentPath?: string
  /** Original filename of the attached document, for display. */
  documentName?: string
  status: PropertyStatus
  agentId: AgentId
}

export const PROPERTIES: Property[] = [
  { id: 1,  title: 'Raouché Appartement',   type: 'Appartement', transaction: 'For Sale', price: 480000,  rent: 0,    district: 'Raouché',    city: 'Beirut',   size: 145, beds: 3, baths: 2, garden: false, balcony: true,  view: 'Sea',       status: 'Available', agentId: 'a1',
    photos: ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=80','https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80','https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80'] },
  { id: 2,  title: 'Dbayeh Villa',           type: 'Villa',       transaction: 'For Sale', price: 1200000, rent: 0,    district: 'Dbayeh',     city: 'Metn',     size: 450, beds: 5, baths: 4, garden: true,  balcony: true,  view: 'Mountain',  status: 'Pending',   agentId: 'a2',
    photos: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80','https://images.unsplash.com/photo-1613490493576-4d0d8a06e657?w=800&q=80','https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80'] },
  { id: 3,  title: 'Achrafieh Penthouse',   type: 'Appartement', transaction: 'For Sale', price: 980000,  rent: 0,    district: 'Achrafieh',  city: 'Beirut',   size: 220, beds: 4, baths: 3, garden: false, balcony: true,  view: 'City',      status: 'Available', agentId: 'a1',
    photos: ['https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80','https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80'] },
  { id: 4,  title: 'Biyada Building',        type: 'Building',    transaction: 'For Sale', price: 790000,  rent: 0,    district: 'Biyada',     city: 'Metn',     size: 320, beds: 4, baths: 3, garden: true,  balcony: true,  view: 'Open',      status: 'Available', agentId: 'a3',
    photos: ['https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80','https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80','https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=800&q=80'] },
  { id: 5,  title: 'Broumana Villa',         type: 'Villa',       transaction: 'For Sale', price: 2100000, rent: 0,    district: 'Broumana',   city: 'Metn',     size: 650, beds: 6, baths: 5, garden: true,  balcony: true,  view: 'Valley',    status: 'Available', agentId: 'a2',
    photos: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80','https://images.unsplash.com/photo-1600047508788-786f3865b87e?w=800&q=80','https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?w=800&q=80'] },
  { id: 6,  title: 'Jounieh Studio',         type: 'Appartement', transaction: 'For Rent', price: 0,       rent: 900,  district: 'Jounieh',    city: 'Keserwan', size: 65,  beds: 1, baths: 1, garden: false, balcony: true,  view: 'Sea',       status: 'Available', agentId: 'a4', advancedPayment: '3 months',
    photos: ['https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80','https://images.unsplash.com/photo-1536376072261-38c75010e6c9?w=800&q=80'] },
  { id: 7,  title: 'Hamra Office',           type: 'Office',      transaction: 'For Rent', price: 0,       rent: 2400, district: 'Hamra',      city: 'Beirut',   size: 180, beds: 0, baths: 2, garden: false, balcony: false, view: 'Street',    status: 'Reserved',  agentId: 'a1', advancedPayment: '6 months',
    photos: ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80','https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80','https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&q=80'] },
  { id: 8,  title: 'Mansourieh Building',    type: 'Building',    transaction: 'For Sale', price: 650000,  rent: 0,    district: 'Mansourieh', city: 'Metn',     size: 280, beds: 4, baths: 3, garden: true,  balcony: true,  view: 'Mountain',  status: 'Available', agentId: 'a3',
    photos: ['https://images.unsplash.com/photo-1600210492493-0946911123ea?w=800&q=80','https://images.unsplash.com/photo-1598228723793-52759bba239c?w=800&q=80'] },
  { id: 9,  title: 'Gemmayzeh Flat',         type: 'Appartement', transaction: 'For Rent', price: 0,       rent: 1500, district: 'Gemmayzeh',  city: 'Beirut',   size: 110, beds: 2, baths: 1, garden: false, balcony: true,  view: 'City',      status: 'Available', agentId: 'a4',
    photos: ['https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=800&q=80','https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80'] },
  { id: 10, title: 'Antelias Showroom',      type: 'Showroom',    transaction: 'For Sale', price: 520000,  rent: 0,    district: 'Antelias',   city: 'Metn',     size: 240, beds: 0, baths: 2, garden: false, balcony: false, view: 'Open',      status: 'Sold',      agentId: 'a2',
    photos: ['https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80','https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800&q=80'] },
  { id: 11, title: 'Keserwan Villa',         type: 'Villa',       transaction: 'For Sale', price: 1650000, rent: 0,    district: 'Ghazir',     city: 'Keserwan', size: 520, beds: 5, baths: 4, garden: true,  balcony: true,  view: 'Sea',       status: 'Available', agentId: 'a3',
    photos: ['https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80','https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=800&q=80','https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=800&q=80'] },
]

export type ClientType = 'Buyer' | 'Renter'
export type ClientStatus = 'Searching' | 'Negotiation' | 'Signed' | 'Viewing'

export interface ClientReq {
  transaction: Transaction | ''
  type: PropertyType | ''
  location: string            // display string (all areas, comma-joined)
  locations?: string[]        // the areas the client is open to (for matching)
  priceMin: number
  priceMax: number
  beds: number
  baths: number
  size: number
  parkings?: number
  garden: boolean
  balcony: boolean
  view?: string               // preferred view (Sea, Mountain…)
  furnishing?: Furnishing | ''
  buildingAge?: number        // max acceptable building age (yrs)
  floor?: Floor | ''
  advancedPayment?: boolean   // renter can pay advanced (optional)
  notes: string
}

export interface Client {
  id: number
  name: string
  type: ClientType
  email: string
  phone: string
  budget: number
  agentId: AgentId
  status: ClientStatus
  req: ClientReq
  leadScore?: number     // 0-100 lead score (Phase 2)
  agentRating?: number   // agent's 1-5 star gut-feel rating
  masked?: boolean       // another agent's client: name/phone hidden, read-only
  tags?: string[]        // free-form labels for grouping (Hot / Investor / …)
}

// Suggested client tags. Agents can also type their own — these are just the
// quick-pick chips shown in the editor and the filter bar.
export const CLIENT_TAG_PRESETS = ['Hot', 'Warm', 'Investor', 'First-time', 'VIP', 'Cash', 'Urgent'] as const

// A stable colour for a tag chip, derived from the text so the same tag always
// looks the same without needing a stored palette.
export function tagStyle(tag: string): { bg: string; color: string } {
  const palette = [
    { bg: '#FBE7E7', color: '#A23434' }, { bg: '#E3F4EA', color: '#1F7A4D' },
    { bg: '#E6EEFB', color: '#2E5288' }, { bg: '#FBEFD6', color: '#9A6516' },
    { bg: '#EFE7FB', color: '#5B3AA2' }, { bg: '#E0F2F4', color: '#1B6C74' },
  ]
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export const CLIENTS: Client[] = [
  {
    id: 1, name: 'Michel Tanios', type: 'Buyer', email: 'michel.tanios@email.com', phone: '+961 3 221 904', budget: 700000, agentId: 'a1', status: 'Searching',
    req: { transaction: 'For Sale', type: 'Appartement', location: 'Metn', priceMin: 500000, priceMax: 700000, beds: 3, baths: 2, size: 130, garden: false, balcony: true, notes: 'Wants a sea or open view, move-in ready.' },
  },
  {
    id: 4, name: 'Sara Stephan', type: 'Renter', email: 'sara.stephan@email.com', phone: '+961 71 309 887', budget: 1300, agentId: 'a3', status: 'Signed',
    req: { transaction: 'For Rent', type: 'Appartement', location: 'Beirut', priceMin: 900, priceMax: 1300, beds: 1, baths: 1, size: 60, garden: false, balcony: false, advancedPayment: true, notes: 'Young professional, prefers furnished, close to Hamra.' },
  },
  {
    id: 5, name: 'Joseph Rizk', type: 'Buyer', email: 'joseph.rizk@email.com', phone: '+961 3 612 470', budget: 900000, agentId: 'a2', status: 'Searching',
    req: { transaction: 'For Sale', type: 'Villa', location: 'Keserwan', priceMin: 700000, priceMax: 900000, beds: 4, baths: 3, size: 280, garden: true, balcony: true, notes: 'Family of five, needs garden and parking.' },
  },
  {
    id: 6, name: 'Maya Fares', type: 'Buyer', email: 'maya.fares@email.com', phone: '+961 76 884 213', budget: 560000, agentId: 'a4', status: 'Viewing',
    req: { transaction: 'For Sale', type: 'Appartement', location: 'Beirut', priceMin: 400000, priceMax: 560000, beds: 2, baths: 1, size: 100, garden: false, balcony: true, notes: 'First-time buyer, prefers Achrafieh or Gemmayzeh.' },
  },
  {
    id: 7, name: 'Tony Abi Hanna', type: 'Buyer', email: 'tony.abihanna@email.com', phone: '+961 3 445 009', budget: 1800000, agentId: 'a4', status: 'Searching',
    req: { transaction: 'For Sale', type: 'Villa', location: 'Keserwan', priceMin: 1400000, priceMax: 1800000, beds: 5, baths: 4, size: 500, garden: true, balcony: true, notes: 'Looking for a summer residence with mountain views.' },
  },
]

export interface Deal {
  id: number
  propTitle: string
  type: PropertyType
  transaction: 'Sale' | 'Rent'
  location: string
  agentId: AgentId
  value: number       // sale price or annual rent
  days: number
  date: string
  clientName?: string
}

export const DEALS: Deal[] = [
  // ── 2026 ─────────────────────────────────────────────────────────────────────
  { id:  1, propTitle: 'Hamra Office Suite',        type: 'Office',      transaction: 'Sale', location: 'Hamra, Beirut',        agentId: 'a1', value: 610000,  days: 32, date: '2026-05-18', clientName: 'Michel Tanios'    },
  { id:  2, propTitle: 'Naccache Appartement',      type: 'Appartement', transaction: 'Sale', location: 'Naccache, Metn',       agentId: 'a2', value: 395000,  days: 41, date: '2026-05-04', clientName: 'Joelle Karam'     },
  { id:  3, propTitle: 'Broumana Villa',             type: 'Villa',       transaction: 'Sale', location: 'Broumana, Metn',       agentId: 'a2', value: 2050000, days: 28, date: '2026-04-22', clientName: 'George Nassar'    },
  { id:  4, propTitle: 'Gemmayzeh Duplex',           type: 'Appartement', transaction: 'Sale', location: 'Gemmayzeh, Beirut',    agentId: 'a3', value: 740000,  days: 55, date: '2026-04-10', clientName: 'Rania Khoury'     },
  { id:  5, propTitle: 'Keserwan Building',          type: 'Building',    transaction: 'Sale', location: 'Ghazir, Keserwan',     agentId: 'a4', value: 680000,  days: 38, date: '2026-03-28', clientName: 'Fadi Abi Nader'   },
  { id:  6, propTitle: 'Raouché Sea View Flat',      type: 'Appartement', transaction: 'Rent', location: 'Raouché, Beirut',      agentId: 'a1', value: 28800,   days: 14, date: '2026-03-10', clientName: 'Carla Sfeir'      },
  { id:  7, propTitle: 'Ashrafieh Studio',           type: 'Appartement', transaction: 'Rent', location: 'Ashrafieh, Beirut',    agentId: 'a1', value: 14400,   days: 9,  date: '2026-01-22', clientName: 'Tony Rizk'        },
  // ── 2025 ─────────────────────────────────────────────────────────────────────
  { id:  8, propTitle: 'Verdun Appartement',         type: 'Appartement', transaction: 'Sale', location: 'Verdun, Beirut',       agentId: 'a1', value: 520000,  days: 44, date: '2025-11-03', clientName: 'Mariam Haddad'    },
  { id:  9, propTitle: 'Jounieh Sea Villa',          type: 'Villa',       transaction: 'Sale', location: 'Jounieh, Keserwan',    agentId: 'a1', value: 1450000, days: 60, date: '2025-09-17', clientName: 'Elie Gemayel'     },
  { id: 10, propTitle: 'Mar Mikhael Loft',           type: 'Appartement', transaction: 'Rent', location: 'Mar Mikhael, Beirut',  agentId: 'a1', value: 18000,   days: 7,  date: '2025-08-05', clientName: 'Nadia Karam'      },
  { id: 11, propTitle: 'Kaslik Office Floor',        type: 'Office',      transaction: 'Sale', location: 'Kaslik, Keserwan',     agentId: 'a1', value: 890000,  days: 51, date: '2025-06-14', clientName: 'Bassam Khalil'    },
  { id: 12, propTitle: 'Mtayleb Villa',              type: 'Villa',       transaction: 'Rent', location: 'Mtayleb, Metn',        agentId: 'a1', value: 36000,   days: 22, date: '2025-04-28', clientName: 'Dina Assaf'       },
  { id: 13, propTitle: 'Hamra Corner Appartement',   type: 'Appartement', transaction: 'Sale', location: 'Hamra, Beirut',        agentId: 'a2', value: 310000,  days: 35, date: '2025-03-11', clientName: 'Samir Toufic'     },
  // ── 2024 ─────────────────────────────────────────────────────────────────────
  { id: 14, propTitle: 'Dbayeh Waterfront Apt',      type: 'Appartement', transaction: 'Sale', location: 'Dbayeh, Metn',         agentId: 'a1', value: 680000,  days: 38, date: '2024-12-08', clientName: 'Roy Abi Nader'    },
  { id: 15, propTitle: 'Beit Mery Chalet',           type: 'Villa',       transaction: 'Sale', location: 'Beit Mery, Metn',      agentId: 'a1', value: 950000,  days: 72, date: '2024-09-25', clientName: 'Lina Frem'        },
  { id: 16, propTitle: 'Raouché Penthouse',          type: 'Appartement', transaction: 'Rent', location: 'Raouché, Beirut',      agentId: 'a1', value: 48000,   days: 18, date: '2024-08-14', clientName: 'Ali Mounzer'      },
  { id: 17, propTitle: 'Jal el Dib Office',          type: 'Office',      transaction: 'Sale', location: 'Jal el Dib, Metn',     agentId: 'a1', value: 430000,  days: 29, date: '2024-05-30', clientName: 'Claude Najjar'    },
  { id: 18, propTitle: 'Antelias Showroom',          type: 'Showroom',    transaction: 'Rent', location: 'Antelias, Metn',       agentId: 'a1', value: 16800,   days: 11, date: '2024-02-19', clientName: 'Petra Khoury'     },
  // ── 2023 ─────────────────────────────────────────────────────────────────────
  { id: 19, propTitle: 'Achrafieh Heritage Apt',     type: 'Appartement', transaction: 'Sale', location: 'Ashrafieh, Beirut',    agentId: 'a1', value: 490000,  days: 48, date: '2023-10-22', clientName: 'Rima Saade'       },
  { id: 20, propTitle: 'Baabda Panoramic Building',  type: 'Building',    transaction: 'Sale', location: 'Baabda, Beirut',       agentId: 'a1', value: 760000,  days: 65, date: '2023-07-04', clientName: 'Chadi Bou Merhi'  },
  { id: 21, propTitle: 'Monot Appartement',          type: 'Appartement', transaction: 'Rent', location: 'Monot, Beirut',        agentId: 'a1', value: 21600,   days: 13, date: '2023-04-17', clientName: 'Sandra Rizk'      },
  { id: 22, propTitle: 'Zalka Modern Flat',          type: 'Appartement', transaction: 'Sale', location: 'Zalka, Metn',          agentId: 'a1', value: 320000,  days: 33, date: '2023-02-09', clientName: 'Nour Geagea'      },
]

// Matching algorithm lives in src/lib/matching.ts (shared by the UI + tests).

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const CURRENT_AGENT_ID: AgentId = 'a1'  // Lara Khoury (logged-in user)

export function getAgent(id: AgentId): Agent {
  return AGENTS.find(a => a.id === id)!
}

export function formatPrice(value: number, currency = 'USD'): string {
  return `${currency} ${value.toLocaleString('en-US')}`
}

export const TYPE_GRADIENTS: Record<PropertyType, string> = {
  Appartement: 'linear-gradient(135deg,#16294A,#2E5288)',
  Duplex:      'linear-gradient(135deg,#1B2E52,#3A62A8)',
  Studio:      'linear-gradient(135deg,#123B3A,#1E7A78)',
  Villa:       'linear-gradient(135deg,#13403A,#1F8A5B)',
  Chalet:      'linear-gradient(135deg,#20301A,#4A7A2E)',
  Standalone:  'linear-gradient(135deg,#3A2A1A,#A56A2E)',
  Office:      'linear-gradient(135deg,#1E2A3A,#4A5A70)',
  Building:    'linear-gradient(135deg,#2A1E3A,#6A4A90)',
  Shop:        'linear-gradient(135deg,#3A2A14,#9A6516)',
  Land:        'linear-gradient(135deg,#1A3020,#2E7A4A)',
  Showroom:    'linear-gradient(135deg,#3A1A2A,#9A3460)',
  Restaurant:  'linear-gradient(135deg,#3A1A14,#C04A20)',
  Garage:      'linear-gradient(135deg,#26303A,#556170)',
  Warehouse:   'linear-gradient(135deg,#2E2A20,#7A6A3A)',
}

export function typeStyle(type: PropertyType): { bg: string; color: string } {
  const map: Record<PropertyType, { bg: string; color: string }> = {
    Appartement: { bg: '#EAF0FA', color: '#2E5288' },
    Duplex:      { bg: '#E7EEFB', color: '#345FA0' },
    Studio:      { bg: '#E0F3F2', color: '#1C6E6C' },
    Villa:       { bg: '#E3F4EA', color: '#1F7A4D' },
    Chalet:      { bg: '#EAF3E2', color: '#3E6A28' },
    Standalone:  { bg: '#F6EDDF', color: '#8A5A24' },
    Office:      { bg: '#F0F4FA', color: '#4A5A70' },
    Building:    { bg: '#F0EAFA', color: '#6A4A90' },
    Shop:        { bg: '#FBEFD6', color: '#9A6516' },
    Land:        { bg: '#E8F4ED', color: '#2E7A4A' },
    Showroom:    { bg: '#FAEBF4', color: '#9A3460' },
    Restaurant:  { bg: '#FAE8E3', color: '#C04A20' },
    Garage:      { bg: '#EDF0F4', color: '#556170' },
    Warehouse:   { bg: '#F1EEE2', color: '#6E6132' },
  }
  return map[type] ?? { bg: '#F0F2F5', color: '#6A7488' }
}

export function statusStyle(status: PropertyStatus | ClientStatus): { bg: string; color: string } {
  switch (status) {
    case 'Available': case 'Searching': case 'Viewing':
      return { bg: '#E3F4EA', color: '#1F7A4D' }
    case 'Pending': case 'Negotiation':
      return { bg: '#FBEFD6', color: '#9A6516' }
    case 'Sold': case 'Signed':
      return { bg: '#EAF0FA', color: '#2E5288' }
    case 'Reserved':
      return { bg: '#F0EAFA', color: '#6A34A2' }
    default:
      return { bg: '#F0F2F5', color: '#6A7488' }
  }
}

export const CLIENT_TYPE_STYLE: Record<ClientType, { bg: string; color: string }> = {
  Buyer:  { bg: '#EAF0FA', color: '#2E5288' },
  Renter: { bg: '#E3F4EA', color: '#1F7A4D' },
}

export function buildDesc(p: Property): string {
  // A description written/generated for this listing always wins — this used
  // to be ignored, so AI/template descriptions were saved but never shown.
  if (p.aiDescription && p.aiDescription.trim()) return p.aiDescription.trim()

  const agent = getAgent(p.agentId)
  const price = p.transaction === 'For Rent'
    ? `${formatPrice(p.rent)}/mo`
    : formatPrice(p.price)
  const advPay = p.advancedPayment ? ` Advanced payment required: ${p.advancedPayment}.` : ''
  return `${p.title} is a ${p.size} m² ${p.type.toLowerCase()} located in ${p.district}, ${p.city}, offered ${p.transaction.toLowerCase()} at ${price}.${p.beds > 0 ? ` Features ${p.beds} bedroom(s) and ${p.baths} bathroom(s).` : ''}${p.garden ? ' Private garden.' : ''}${p.balcony ? ' Balcony.' : ''} ${p.view} view.${advPay} Listed by ${agent.name}.`
}
