// Server-only — never import this in client components
import Stripe from 'stripe'
import { PLANS } from './stripe-plans'
import type { PlanId } from './stripe-plans'

export { PLANS }
export type { PlanId }

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia',
  })
}

export function getPriceId(planId: PlanId): string {
  const plan = PLANS.find(p => p.id === planId)
  if (!plan) throw new Error(`Unknown plan: ${planId}`)
  const key = `STRIPE_PRICE_${planId.toUpperCase()}`
  const priceId = process.env[key]
  if (!priceId) throw new Error(`Missing env var: ${key}`)
  return priceId
}
