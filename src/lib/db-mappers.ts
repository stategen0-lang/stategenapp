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
    needsRenovation: !!(extras.needsRenovation),
    photos: (() => { try { return JSON.parse(row.Photos as string || '[]') } catch { return [] } })(),
  }
}

export function dbRowToClient(row: Record<string, unknown>, idx: number): Client {
  let extras: Record<string, unknown> = {}
  try { extras = JSON.parse(row.notes as string || '{}') } catch {}
  const reqExtras = (extras.req as Record<string, unknown>) ?? {}
  const req: ClientReq = {
    transaction: (row['payment_terms'] as ClientReq['transaction']) ?? '',
    type: (reqExtras.type as ClientReq['type']) ?? '',
    location: (row['prefered-location'] as string) ?? '',
    priceMin: (row['budget_min'] as number) ?? 0,
    priceMax: (row['budget_max'] as number) ?? 0,
    beds: (row['bedrooms'] as number) ?? 0,
    baths: (reqExtras.baths as number) ?? 0,
    size: (reqExtras.size as number) ?? 0,
    parkings: reqExtras.parkings as number | undefined,
    garden: false,
    balcony: false,
    notes: '',
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
  }
}
