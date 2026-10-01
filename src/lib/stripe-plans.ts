// Client-safe: no Stripe SDK import here.
//
// Every plan includes FULL access to the whole product — they differ only by how
// many users (managers + agents) the agency can have. All plans get a 1-month
// free trial, and a promo code can be entered at checkout.
//
// Longer commitments are a manual arrangement handled at invoicing time:
//   - 6-month: pay for 5 (1 month free) — Business & Company
//   - yearly:  pay for 10 (2 months free) — Business & Company
//   - Team:    flat $1,000 / 6 months, $2,000 / year
// The `price` below is the monthly rate; Charbel applies the multi-month promos
// per invoice in the admin panel.

export const TRIAL_DAYS = 30

// Identical across tiers — the plans differ only by user count.
const FULL_ACCESS: string[] = [
  'Full CRM, smart matching & commissions',
  'Deal pipeline & lead scoring',
  'WhatsApp assistant & reminders',
  'AI listing descriptions',
  'Shareable listing pages & bulk import',
  'Analytics & reports',
]

export const PLANS = [
  {
    id: 'team' as const,
    name: 'Team',
    price: 200 as number | null,
    agentLimit: 9 as number | null,
    agents: '0–9 users',
    tagline: 'Full access — for a small, boutique agency',
    features: FULL_ACCESS,
  },
  {
    id: 'business' as const,
    name: 'Business',
    price: 350 as number | null,
    agentLimit: 29 as number | null,
    agents: '10–29 users',
    tagline: 'Full access — where most agencies start',
    features: FULL_ACCESS,
    popular: true,
  },
  {
    id: 'company' as const,
    name: 'Company',
    price: 450 as number | null,
    agentLimit: 59 as number | null,
    agents: '30–59 users',
    tagline: 'Full access — for larger, multi-team agencies',
    features: FULL_ACCESS,
  },
  {
    // NOTE: the internal id stays 'unlimited' so existing customer records
    // (company.Plan === 'unlimited') keep their uncapped seats. It is shown to
    // users as "Enterprise". Price is null = custom ("talk to us").
    id: 'unlimited' as const,
    name: 'Enterprise',
    price: null as number | null,
    agentLimit: null as number | null,
    agents: '60+ users',
    tagline: 'Full access — no user cap, tailored to your firm',
    features: FULL_ACCESS,
  },
]

export type PlanId = (typeof PLANS)[number]['id']

export function planFor(id: string | null | undefined) {
  return PLANS.find(p => p.id === id)
}

/** Max users (managers + agents) for a plan; null = unlimited. Unknown plans
 *  default to the smallest cap so a mis-set plan can never grant unlimited
 *  seats by accident. */
export function agentLimitFor(id: string | null | undefined): number | null {
  const p = planFor(id)
  return p ? p.agentLimit : 9
}
