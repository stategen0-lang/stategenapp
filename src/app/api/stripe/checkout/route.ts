import { NextRequest, NextResponse } from 'next/server'
import { stripe, getPriceId, PlanId } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  try {
    const { companyName, domain, email, planId } = await req.json()

    if (!companyName || !domain || !email || !planId) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: getPriceId(planId as PlanId), quantity: 1 }],
      metadata: {
        company_name: companyName,
        domain: domain.toLowerCase().trim(),
        email,
        plan_id: planId,
      },
      subscription_data: {
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
