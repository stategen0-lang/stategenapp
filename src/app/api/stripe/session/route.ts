import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id.' }, { status: 400 })

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    // Checkout is "complete" once the customer finishes — even on a free trial,
    // where no payment is taken upfront (payment_status is 'no_payment_required',
    // not 'paid'). Gating on 'paid' would reject every trial signup.
    if (session.status !== 'complete') {
      return NextResponse.json({ error: 'Checkout not completed.' }, { status: 402 })
    }

    const meta = session.metadata ?? {}
    return NextResponse.json({
      companyName: meta.company_name ?? '',
      domain: meta.domain ?? '',
      email: meta.email ?? session.customer_email ?? '',
      planId: meta.plan_id ?? 'team',
      customerId: (session.customer as string) ?? '',
      subscriptionId: (session.subscription as string) ?? '',
    })
  } catch (err: unknown) {
    console.error('[stripe/session]', err)
    return NextResponse.json({ error: 'Could not retrieve session.' }, { status: 500 })
  }
}
