import type { Metadata } from 'next'
import LegalPage, { H2, P, UL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: 'StateGen refund and cancellation policy.',
}

const UPDATED = 'September 7, 2026'
const CONTACT = 'support@stategenapp.com'

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund Policy" updated={UPDATED}>
      <P>
        This Refund Policy applies to all subscriptions and payments made for access to the StateGen
        platform (the &quot;Service&quot;). By subscribing, you agree to these terms.
      </P>

      <H2>How billing works</H2>
      <P>
        StateGen operates on a manual billing model. Access is granted for a fixed period after
        payment is confirmed directly with StateGen. Your subscription period and price are agreed
        upon before payment is made.
      </P>

      <H2>Refund eligibility</H2>
      <UL>
        <li>
          <strong>Within 7 days of activation:</strong> If you are not satisfied with the Service
          and have not made significant use of it (fewer than 10 active client or property records
          created), you may request a full refund within 7 days of your account being activated.
        </li>
        <li>
          <strong>After 7 days:</strong> Payments are non-refundable. You will retain full access
          for the remainder of your paid period.
        </li>
        <li>
          <strong>Service unavailability:</strong> If the Service is unavailable for more than 48
          consecutive hours due to issues on our end, we will extend your subscription by the
          equivalent downtime at no charge.
        </li>
      </UL>

      <H2>Cancellation</H2>
      <P>
        You may cancel at any time by contacting us. Cancellation stops future renewals — it does
        not entitle you to a refund for any remaining paid period. Your access continues until the
        end of your current subscription period.
      </P>

      <H2>How to request a refund</H2>
      <P>
        Email <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a> with your agency
        name, the email address used to register, and the reason for your request. We will respond
        within 3 business days.
      </P>

      <H2>Changes to this policy</H2>
      <P>
        We may update this policy from time to time. Changes apply to subscriptions taken out after
        the updated date.
      </P>
    </LegalPage>
  )
}
