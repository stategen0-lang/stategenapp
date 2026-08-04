import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// Finish a company signup after Stripe checkout — server-side.
//
// Done on the server because the project has "Confirm email" ON, so a browser
// supabase.auth.signUp returns NO session, and the follow-up Company/Profile
// inserts would then run unauthenticated and fail. Here the manager account is
// created with email_confirm:true (they can sign in immediately) and Company +
// Profile are written with the admin client. The Stripe session is the source
// of truth for the company details, not the client.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, password } = await req.json()
    if (!sessionId || !password) {
      return NextResponse.json({ error: 'Missing session or password.' }, { status: 400 })
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    // Verify the checkout is genuinely complete (trial counts — no upfront pay).
    const session = await getStripe().checkout.sessions.retrieve(sessionId)
    if (session.status !== 'complete') {
      return NextResponse.json({ error: 'Checkout is not complete.' }, { status: 402 })
    }
    const meta = session.metadata ?? {}
    const email = (meta.email || session.customer_email || '').toLowerCase().trim()
    const domain = (meta.domain || '').toLowerCase().trim()
    const companyName = meta.company_name || domain
    const planId = meta.plan_id || 'team'
    if (!email || !domain) {
      return NextResponse.json({ error: 'That checkout session is missing company details.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 1. Manager auth account — confirmed, so they can sign in right away.
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `${companyName} Manager` },
    })
    if (authErr || !created?.user) {
      const already = /already|registered|exists/i.test(authErr?.message ?? '')
      return NextResponse.json(
        { error: already ? 'An account already exists for this email — please sign in.' : (authErr?.message ?? 'Could not create the account.'), email },
        { status: already ? 409 : 500 },
      )
    }

    // 2. Company (idempotent with the Stripe webhook, keyed on domain).
    const { data: company, error: companyErr } = await admin
      .from('Companies')
      .upsert({
        Name: companyName,
        domain,
        Plan: planId,
        'is active': true,
        stripe_customer_id: (session.customer as string) || null,
        stripe_subscription_id: (session.subscription as string) || null,
        stripe_status: 'active',
      }, { onConflict: 'domain' })
      .select()
      .single()
    if (companyErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: companyErr.message }, { status: 500 })
    }

    // 3. Manager profile (owner, pre-approved).
    const { error: profileErr } = await admin.from('Profiles').insert({
      id: created.user.id,
      company_id: company.id,
      Full_name: `${companyName} Manager`,
      role: 'owner',
      approved: true,
    })
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, email })
  } catch (err) {
    console.error('[signup/complete]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed.' }, { status: 500 })
  }
}
