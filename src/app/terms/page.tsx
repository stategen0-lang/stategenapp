import type { Metadata } from 'next'
import LegalPage, { H2, P, UL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service · StateGen',
  description: 'The terms governing use of the StateGen real estate platform.',
}

const UPDATED = 'July 31, 2026'
const CONTACT = 'stategen0@gmail.com'

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={UPDATED}>
      <P>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of StateGen (the
        &quot;Service&quot;), a real estate management platform. By creating an account, subscribing,
        or otherwise using the Service, you agree to these Terms on behalf of yourself and the
        agency you represent. If you do not agree, do not use the Service.
      </P>

      <H2>1. The Service</H2>
      <P>
        StateGen provides tools for real estate agencies to manage property listings, clients,
        deal pipelines, communications (including an optional WhatsApp assistant), and related
        analytics. Features may change over time as the Service evolves.
      </P>

      <H2>2. Accounts and your team</H2>
      <UL>
        <li>A manager creates the company account and may invite agents to join under the agency&apos;s domain. New agents require manager approval before they can access the account.</li>
        <li>You are responsible for keeping login credentials secure and for all activity under your account and your agents&apos; accounts.</li>
        <li>You must provide accurate information and are responsible for the accuracy of the listing, client, and deal data you enter.</li>
        <li>Each subscription tier permits a maximum number of active agents. Removing an agent frees a seat.</li>
      </UL>

      <H2>3. Subscriptions, trial, and billing</H2>
      <UL>
        <li>Paid plans are billed monthly through our payment processor, Stripe. By subscribing you authorise recurring charges to your payment method until you cancel.</li>
        <li>New subscriptions include a one-month free trial. You will not be charged during the trial and may cancel before it ends to avoid charges.</li>
        <li>Promotional codes, where offered, are applied at checkout and are subject to their own terms.</li>
        <li>You may cancel at any time; access continues until the end of the current billing period. Except where required by law, payments are non-refundable.</li>
        <li>We may change plan pricing or features with reasonable prior notice.</li>
      </UL>

      <H2>4. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <li>use the Service unlawfully or to store or send unlawful, infringing, or misleading content;</li>
        <li>message individuals through the Service without a lawful basis or the consent required by applicable law and WhatsApp&apos;s policies;</li>
        <li>attempt to access another company&apos;s data, probe or breach security, or disrupt the Service;</li>
        <li>resell or provide the Service to third parties except your own agents; or</li>
        <li>reverse engineer or copy the Service except as permitted by law.</li>
      </UL>

      <H2>5. Your data</H2>
      <P>
        As between you and StateGen, you own the data you and your agents submit (listings, clients,
        deals, messages). You grant us the rights needed to host and process that data to provide the
        Service. Our handling of personal data is described in our{' '}
        <a href="/privacy" style={{ color: '#5E8FD6' }}>Privacy Policy</a>.
      </P>

      <H2>6. Third-party services</H2>
      <P>
        The Service relies on third parties including Stripe (payments), Twilio and/or Meta/WhatsApp
        (messaging), Supabase (database and authentication), Vercel (hosting), and an AI provider used
        for description generation and message understanding. Your use of features that depend on these
        providers is also subject to their terms.
      </P>

      <H2>7. Intellectual property</H2>
      <P>
        The Service, including its software, design, and brand, is owned by StateGen and its licensors.
        These Terms grant you a limited, non-exclusive, non-transferable right to use the Service during
        your subscription.
      </P>

      <H2>8. Disclaimers</H2>
      <P>
        The Service is provided &quot;as is&quot; without warranties of any kind, to the fullest extent
        permitted by law. We do not warrant that the Service will be uninterrupted or error-free, and
        we are not a party to any transaction between you and your clients. AI-generated content
        (such as listing descriptions) may contain errors and should be reviewed before use.
      </P>

      <H2>9. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, StateGen will not be liable for indirect, incidental,
        special, or consequential damages, or for lost profits or data. Our total liability for any
        claim relating to the Service will not exceed the amount you paid us in the twelve months
        before the claim.
      </P>

      <H2>10. Termination</H2>
      <P>
        You may stop using and cancel the Service at any time. We may suspend or terminate access for
        breach of these Terms or non-payment. On termination, your right to use the Service ends; we
        may delete account data after a reasonable period.
      </P>

      <H2>11. Changes</H2>
      <P>
        We may update these Terms from time to time. Material changes will be notified through the
        Service or by email. Continued use after changes take effect constitutes acceptance.
      </P>

      <H2>12. Governing law</H2>
      <P>
        These Terms are governed by the laws of Lebanon, without regard to conflict-of-law rules, and
        the courts of Beirut, Lebanon have exclusive jurisdiction, unless applicable law requires
        otherwise.
      </P>

      <H2>13. Contact</H2>
      <P>Questions about these Terms: <a href={`mailto:${CONTACT}`} style={{ color: '#5E8FD6' }}>{CONTACT}</a>.</P>
    </LegalPage>
  )
}
