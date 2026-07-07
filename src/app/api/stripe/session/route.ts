import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id.' }, { status: 400 })

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed.' }, { status: 402 })
    }

    const meta = session.metadata ?? {}
    return NextResponse.json({
      companyName: meta.company_name ?? '',
      domain: meta.domain ?? '',
      email: meta.email ?? session.customer_email ?? '',
      planId: meta.plan_id ?? 'starter',
      customerId: (session.customer as string) ?? '',
      subscriptionId: (session.subscription as string) ?? '',
    })
  } catch (err: unknown) {
    console.error('[stripe/session]', err)
    return NextResponse.json({ error: 'Could not retrieve session.' }, { status: 500 })
  }
}
