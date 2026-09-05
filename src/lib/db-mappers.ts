// Shared helpers to convert Supabase rows into the app's UI shapes.
// Used by the dashboard, properties, and clients pages so the mapping stays
// in one place.

import { Property, Client, ClientReq } from '@/lib/data'

export function dbRowToProperty(row: Record<string, unknown>, idx: number): Property {
  let extras: Record<string, unknown> = {}
  try { extras = JSON.parse(row.Amenities as string || '{}') } catch {}
  return {
    id: (row.id as number) ?? idx,
    title: (row.Title as string) ?? '',
    type: (extras.type as Property['type']) ?? 'Appartement',
    // Normalise to the app's transaction enum so 'sale'/'rent' (e.g. imported
    // rows) are recognised, not just the exact 'For Sale'/'For Rent'.
    transaction: (/rent/i.test(String(extras.transaction ?? '')) ? 'For Rent' : 'For Sale') as Property['transaction'],
    price: (row.Price as number) ?? 0,
    rent: (extras.rent as number) ?? 0,
    district: (row.Neighborhood as string) ?? '',
    city: (row.Location as string) ?? '',
    size: (row.size as number) ?? 0,
    beds: (row.Bedrooms as number) ?? 0,
    baths: (row.bathrooms as number) ?? 0,
    garden: !!(extras.garden),
    balcony: !!(extras.balcony),
    view: (extras.view as string) ?? '',
    status: (row.Status as Property['status']) ?? 'Available',
    agentId: (extras.agentId as Property['agentId']) ?? 'a1',
    advancedPayment: extras.advancedPayment as import('@/lib/data').AdvancedPayment | undefined,
    notes: extras.notes as string | undefined,
    aiDescription: extras.aiDescription as string | undefined,
    parkings: extras.parkings as number | undefined,
    buildingAge: extras.buildingAge as number | undefined,
    floor: extras.floor as Property['floor'] | undefined,
    needsRenovation: !!(extras.needsRenovation),
    terrace: !!(extras.terrace),
    amenities: Array.isArray(extras.amenities) ? (extras.amenities as string[]).filter(a => typeof a === 'string') : [],
    buildingFeatures: Array.isArray(extras.buildingFeatures) ? (extras.buildingFeatures as string[]).filter(a => typeof a === 'string') : [],
    furnishing: extras.furnishing as Property['furnishing'] | undefined,
    mapUrl: extras.mapUrl as string | undefined,
    video: extras.video as string | undefined,
    referredBy: extras.referredBy as string | undefined,
    // Private fields — mapped here so the owning agent/managers can see them;
    // callers that serve other agents or the public must strip them.
    ownerName: extras.ownerName as string | undefined,
    ownerContact: extras.ownerContact as string | undefined,
    documentPath: extras.documentPath as string | undefined,
    documentName: extras.documentName as string | undefined,
    photos: (() => { try { return JSON.parse(row.Photos as string || '[]') } catch { return [] } })(),
  }
}

export function dbRowToClient(row: Record<string, unknown>, idx: number): Client {
  let extras: Record<string, unknown> = {}
  try { extras = JSON.parse(row.notes as string || '{}') } catch {}
  const reqExtras = (extras.req as Record<string, unknown>) ?? {}
  // req.type must be a PROPERTY type (Appartement/Villa/…). Older imports wrongly
  // stored a transaction ("For Sale"/"For Rent") here, which then hard-excluded
  // every match on the type filter — so ignore anything that isn't a real type.
  const VALID_REQ_TYPES = new Set(['Appartement', 'Duplex', 'Studio', 'Villa', 'Chalet', 'Standalone', 'Building', 'Land', 'Shop', 'Office', 'Showroom', 'Restaurant', 'Garage', 'Warehouse'])
  const reqType = VALID_REQ_TYPES.has(String(reqExtras.type)) ? (reqExtras.type as ClientReq['type']) : ''
  const reqLocations = Array.isArray(reqExtras.locations)
    ? (reqExtras.locations as string[]).filter(l => typeof l === 'string' && l.trim())
    : []
  const req: ClientReq = {
    transaction: (row['payment_terms'] as ClientReq['transaction']) ?? '',
    type: reqType,
    // The column holds the display string; the array (for matching) lives in the
    // notes blob. Older rows have only the column — fall back to splitting it.
    location: (row['prefered-location'] as string) ?? '',
    locations: reqLocations.length
      ? reqLocations
      : ((row['prefered-location'] as string) || '').split(',').map(s => s.trim()).filter(Boolean),
    priceMin: (row['budget_min'] as number) ?? 0,
    priceMax: (row['budget_max'] as number) ?? 0,
    beds: (row['bedrooms'] as number) ?? 0,
    baths: (reqExtras.baths as number) ?? 0,
    size: (reqExtras.size as number) ?? 0,
    parkings: reqExtras.parkings as number | undefined,
    // These live in the notes blob and were previously not read back on edit.
    garden: !!reqExtras.garden,
    balcony: !!reqExtras.balcony,
    view: (reqExtras.view as string) ?? '',
    furnishing: reqExtras.furnishing as ClientReq['furnishing'],
    buildingAge: reqExtras.buildingAge as number | undefined,
    floor: reqExtras.floor as ClientReq['floor'],
    advancedPayment: reqExtras.advancedPayment as boolean | undefined,
    notes: (reqExtras.notes as string) ?? '',
  }
  return {
    id: (row.id as number) ?? idx,
    name: (row['Client Name'] as string) ?? '',
    // Normalise casing/synonyms → the app's ClientType ('Buyer' | 'Renter'), so
    // imported or externally-written rows never break the UI's style lookup.
    type: (String(extras.type ?? '').toLowerCase().startsWith('rent') ? 'Renter' : 'Buyer') as Client['type'],
    email: (extras.email as string) ?? '',
    phone: (row['client phone'] as string) ?? '',
    budget: (row['budget_max'] as number) ?? 0,
    agentId: (extras.agentId as Client['agentId']) ?? 'a1',
    status: (row['status'] as Client['status']) ?? 'Searching',
    req,
    leadScore: Number(row['lead_score'] ?? 0),
    agentRating: Number(row['agent_rating'] ?? 3),
    masked: row['masked'] === true,
    tags: Array.isArray(extras.tags) ? (extras.tags as string[]).filter(t => typeof t === 'string') : [],
  }
}
