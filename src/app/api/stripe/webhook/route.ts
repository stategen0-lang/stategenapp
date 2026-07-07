import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// Required: disable Next.js body parsing so we get the raw bytes for signature verification
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) return NextResponse.json({ error: 'No signature.' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('[webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const { company_name, domain, plan_id } = session.metadata ?? {}
      if (!domain) break

      // Upsert company with Stripe customer + subscription IDs
      const { error } = await supabase
        .from('Companies')
        .upsert(
          {
            Name: company_name ?? domain,
            domain,
            Plan: plan_id ?? 'starter',
            'is active': true,
            stripe_customer_id: session.customer as string ?? null,
            stripe_subscription_id: session.subscription as string ?? null,
            stripe_status: 'active',
          },
          { onConflict: 'domain' }
        )
      if (error) console.error('[webhook] company upsert error', error)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const { error } = await supabase
        .from('Companies')
        .update({ stripe_status: sub.status })
        .eq('stripe_subscription_id', sub.id)
      if (error) console.error('[webhook] subscription update error', error)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const { error } = await supabase
        .from('Companies')
        .update({ stripe_status: 'canceled', 'is active': false })
        .eq('stripe_subscription_id', sub.id)
      if (error) console.error('[webhook] subscription delete error', error)
      break
    }
  }

  return NextResponse.json({ received: true })
}
