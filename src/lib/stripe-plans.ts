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
    price: 250 as number | null,
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

/**
 * Paying for longer costs less: six months is billed as five, a year as ten.
 * Both come to the same 16.67% off, so the offer is easy to say out loud —
 * "pay for 5, get 6" — and applies to every priced plan alike.
 */
export const PERIOD_OFFERS = [
  { months: 6, payMonths: 5 },
  { months: 12, payMonths: 10 },
] as const

/** The discount, as a percentage, for a period of this many months (0 when there is none). */
export function periodDiscountPct(months: number): number {
  const offer = PERIOD_OFFERS.find(o => o.months === months)
  // Four decimals, so 16.6667% of six months comes back to a whole-dollar total
  // once the invoice rounds to cents.
  return offer ? Math.round((1 - offer.payMonths / offer.months) * 100 * 1e4) / 1e4 : 0
}

/** What a period costs in total at a monthly price, after its discount. */
export function periodTotal(monthlyPrice: number, months: number): number {
  const offer = PERIOD_OFFERS.find(o => o.months === months)
  return offer ? monthlyPrice * offer.payMonths : monthlyPrice * months
}

/** "6 months $1,250 · 1 year $2,500" — what a manager sees under the monthly price. */
export function periodOfferText(monthlyPrice: number): string {
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`
  return PERIOD_OFFERS
    .map(o => `${o.months === 12 ? '1 year' : `${o.months} months`} ${usd(periodTotal(monthlyPrice, o.months))}`)
    .join(' · ')
}

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
