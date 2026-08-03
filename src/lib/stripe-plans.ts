// Client-safe: no Stripe SDK import here.
//
// Every plan includes FULL access to the whole product — they differ only by how
// many agents the agency can have. All plans get a 1-month free trial, and a
// promo code can be entered at checkout.

export const TRIAL_DAYS = 30

// Identical across tiers — the plans differ only by agent count.
const FULL_ACCESS: string[] = [
  'Full CRM, smart matching & commissions',
  'Deal pipeline & lead scoring',
  'WhatsApp assistant',
  'AI listing descriptions',
  'Analytics & reports',
]

export const PLANS = [
  {
    id: 'team' as const,
    name: 'Team',
    price: 150,
    agentLimit: 5 as number | null,
    agents: 'Up to 5 agents',
    tagline: 'Full access — for a small team',
    features: FULL_ACCESS,
  },
  {
    id: 'business' as const,
    name: 'Business',
    price: 200,
    agentLimit: 15 as number | null,
    agents: 'Up to 15 agents',
    tagline: 'Full access — for a growing agency',
    features: FULL_ACCESS,
    popular: true,
  },
  {
    id: 'unlimited' as const,
    name: 'Unlimited',
    price: 300,
    agentLimit: null as number | null,
    agents: 'Unlimited agents',
    tagline: 'Full access — no agent cap',
    features: FULL_ACCESS,
  },
]

export type PlanId = (typeof PLANS)[number]['id']

export function planFor(id: string | null | undefined) {
  return PLANS.find(p => p.id === id)
}

/** Max agents for a plan; null = unlimited. Unknown plans default to the
 *  smallest cap so a mis-set plan can never grant unlimited seats by accident. */
export function agentLimitFor(id: string | null | undefined): number | null {
  const p = planFor(id)
  return p ? p.agentLimit : 5
}
