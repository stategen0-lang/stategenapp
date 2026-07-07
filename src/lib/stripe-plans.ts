// Client-safe: no Stripe SDK import here

export const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: 49,
    agents: '2 agents',
    properties: '50 listings',
    features: ['Smart matching', 'Client management', 'Commission tracking'],
  },
  {
    id: 'pro' as const,
    name: 'Professional',
    price: 99,
    agents: '10 agents',
    properties: 'Unlimited listings',
    features: ['Everything in Starter', 'Analytics dashboard', 'Priority support'],
    popular: true,
  },
  {
    id: 'agency' as const,
    name: 'Agency',
    price: 199,
    agents: 'Unlimited agents',
    properties: 'Unlimited listings',
    features: ['Everything in Pro', 'Custom domain', 'Dedicated account manager'],
  },
]

export type PlanId = (typeof PLANS)[number]['id']
