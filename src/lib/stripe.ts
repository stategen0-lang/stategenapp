// Server-only — never import this in client components
import Stripe from 'stripe'
import { PLANS, PlanId } from './stripe-plans'

export { PLANS, PlanId }

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

export function getPriceId(planId: PlanId): string {
  const plan = PLANS.find(p => p.id === planId)
  if (!plan) throw new Error(`Unknown plan: ${planId}`)
  const key = `STRIPE_PRICE_${planId.toUpperCase()}`
  const priceId = process.env[key]
  if (!priceId) throw new Error(`Missing env var: ${key}`)
  return priceId
}
