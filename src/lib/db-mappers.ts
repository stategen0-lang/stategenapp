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
    transaction: (extras.transaction as Property['transaction']) ?? 'For Sale',
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
  const req: ClientReq = {
    transaction: (row['payment_terms'] as ClientReq['transaction']) ?? '',
    type: ((extras.req as Record<string, unknown>)?.type as ClientReq['type']) ?? '',
    location: (row['prefered-location'] as string) ?? '',
    priceMin: (row['budget_min'] as number) ?? 0,
    priceMax: (row['budget_max'] as number) ?? 0,
    beds: (row['bedrooms'] as number) ?? 0,
    baths: 0,
    size: 0,
    garden: false,
    balcony: false,
    notes: '',
  }
  return {
    id: (row.id as number) ?? idx,
    name: (row['Client Name'] as string) ?? '',
    type: (extras.type as Client['type']) ?? 'Buyer',
    email: (extras.email as string) ?? '',
    phone: (row['client phone'] as string) ?? '',
    budget: (row['budget_max'] as number) ?? 0,
    agentId: (extras.agentId as Client['agentId']) ?? 'a1',
    status: (row['status'] as Client['status']) ?? 'Searching',
    req,
    leadScore: Number(row['lead_score'] ?? 0),
    agentRating: Number(row['agent_rating'] ?? 3),
  }
}
