import type { Metadata } from 'next'
import LegalPage, { H2, P, UL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy · StateGen',
  description: 'How StateGen collects, uses, and protects data.',
}

const UPDATED = 'July 31, 2026'
const CONTACT = 'stategen0@gmail.com'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={UPDATED}>
      <P>
        This Privacy Policy explains how StateGen (&quot;we&quot;) collects, uses, and protects
        information when you use our real estate management platform (the &quot;Service&quot;). It
        covers people who run or work at an agency using StateGen, and the client contact data those
        agencies store in the Service.
      </P>

      <H2>Information we collect</H2>
      <UL>
        <li><strong>Account data:</strong> name, email, agency name and domain, role, agent ID, password (stored hashed by our authentication provider), and — if you connect it — your WhatsApp number and opt-in timestamp.</li>
        <li><strong>Business data you enter:</strong> property listings, client and lead records (which may include client names, phone numbers, budgets, and preferences), deals, calendar events, and notes.</li>
        <li><strong>Messages:</strong> the content of messages exchanged with the optional WhatsApp assistant, and logs of those interactions.</li>
        <li><strong>Payment data:</strong> handled by Stripe. We receive subscription status and identifiers but do not store full card numbers.</li>
        <li><strong>Usage and technical data:</strong> basic logs needed to operate and secure the Service.</li>
      </UL>

      <H2>How we use information</H2>
      <UL>
        <li>To provide and operate the Service, including matching, pipeline, analytics, and the WhatsApp assistant.</li>
        <li>To authenticate users and enforce per-company data isolation and role permissions.</li>
        <li>To process subscriptions and payments.</li>
        <li>To generate listing descriptions and interpret messages using an AI provider.</li>
        <li>To send service-related and reminder messages you have configured.</li>
        <li>To secure, troubleshoot, and improve the Service, and to comply with legal obligations.</li>
      </UL>

      <H2>Client data and your responsibility</H2>
      <P>
        Agencies use StateGen to store information about their own clients and leads. For that data,
        the agency is the controller and StateGen is a processor acting on the agency&apos;s
        instructions. Agencies are responsible for having a lawful basis and any required consent to
        store client data and to contact clients — including via WhatsApp, in line with WhatsApp&apos;s
        policies.
      </P>

      <H2>Service providers we share with</H2>
      <P>We share data only as needed to run the Service, with providers that process it on our behalf:</P>
      <UL>
        <li><strong>Supabase</strong> — database, authentication, and file storage.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Stripe</strong> — payment processing.</li>
        <li><strong>Twilio and/or Meta (WhatsApp)</strong> — message delivery for the assistant.</li>
        <li><strong>An AI provider</strong> — to generate descriptions and interpret messages; message content sent for processing is not used to train third-party models where we can control that setting.</li>
      </UL>
      <P>We do not sell personal data.</P>

      <H2>Data retention</H2>
      <P>
        We keep account and business data for as long as your account is active and for a reasonable
        period afterward, then delete or anonymise it, unless a longer period is required by law.
        Removing an agent or deleting records removes them from active use.
      </P>

      <H2>Security</H2>
      <P>
        We use industry-standard measures including encryption in transit, authenticated access, and
        per-company data separation. No system is perfectly secure, but we work to protect your data
        and to limit access to what each user is permitted to see.
      </P>

      <H2>International transfers</H2>
      <P>
        Our providers may process data in countries other than yours. Where that happens, we rely on
        those providers&apos; safeguards for such transfers.
      </P>

      <H2>Your rights</H2>
      <P>
        Depending on your location, you may have rights to access, correct, export, or delete your
        personal data, or to object to or restrict certain processing. Account users can update much of
        their data in the app; for other requests, contact us. If you are a client of an agency using
        StateGen, please contact that agency, which controls your data.
      </P>

      <H2>Changes</H2>
      <P>
        We may update this Policy from time to time. Material changes will be notified through the
        Service or by email, and the &quot;Last updated&quot; date above will change.
      </P>

      <H2>Contact</H2>
      <P>
        Questions or privacy requests: <a href={`mailto:${CONTACT}`} style={{ color: '#5E8FD6' }}>{CONTACT}</a>.
      </P>
    </LegalPage>
  )
}
