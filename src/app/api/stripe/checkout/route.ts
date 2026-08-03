import { NextRequest, NextResponse } from 'next/server'
import { getStripe, getPriceId, PlanId } from '@/lib/stripe'
import { TRIAL_DAYS } from '@/lib/stripe-plans'

export async function POST(req: NextRequest) {
  try {
    const { companyName, domain, email, planId } = await req.json()

    if (!companyName || !domain || !email || !planId) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: getPriceId(planId as PlanId), quantity: 1 }],
      // Let customers enter a promo code (created in the Stripe dashboard).
      allow_promotion_codes: true,
      metadata: {
        company_name: companyName,
        domain: domain.toLowerCase().trim(),
        email,
        plan_id: planId,
      },
      subscription_data: {
        // 1-month free trial on every plan.
        trial_period_days: TRIAL_DAYS,
        metadata: {
          company_name: companyName,
          domain: domain.toLowerCase().trim(),
        },
      },
      success_url: `${origin}/signup/company/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/signup/company?cancelled=1`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error('[stripe/checkout]', err)
    const message = err instanceof Error ? err.message : 'Stripe error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
