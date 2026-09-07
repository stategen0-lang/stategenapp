import type { Metadata } from 'next'
import LegalPage, { H2, P, UL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: 'How StateGen uses cookies and similar technologies.',
}

const UPDATED = 'September 7, 2026'
const CONTACT = 'support@stategenapp.com'

export default function CookiePolicyPage() {
  return (
    <LegalPage title="Cookie Policy" updated={UPDATED}>
      <P>
        This Cookie Policy explains how StateGen (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) uses
        cookies and similar technologies when you use our platform at stategenapp.vercel.app (the
        &quot;Service&quot;).
      </P>

      <H2>What are cookies?</H2>
      <P>
        Cookies are small text files stored on your device by your browser when you visit a website.
        They help the site remember your session and preferences across page loads.
      </P>

      <H2>Cookies we use</H2>
      <P>We only use cookies that are strictly necessary to operate the Service:</P>
      <UL>
        <li>
          <strong>Authentication cookies</strong> — set by our authentication provider (Supabase) to
          keep you logged in during your session. These expire when you close your browser or after
          a fixed period of inactivity. They are essential and cannot be disabled without breaking
          the Service.
        </li>
        <li>
          <strong>Admin session cookie</strong> — set when an administrator unlocks the admin panel.
          Valid for 8 hours. HttpOnly and not accessible by JavaScript.
        </li>
      </UL>

      <H2>What we do NOT use</H2>
      <UL>
        <li>We do not use advertising or marketing cookies.</li>
        <li>We do not use analytics tracking cookies (e.g. Google Analytics).</li>
        <li>We do not embed third-party widgets that set their own cookies (e.g. social media buttons).</li>
      </UL>

      <H2>Third-party services</H2>
      <P>
        We use Google Fonts to load our interface font. Google may set its own cookies or log your
        IP when fonts are loaded. See{' '}
        <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">
          Google&apos;s Privacy Policy
        </a>{' '}
        for details. No other third-party services embed cookies through our platform.
      </P>

      <H2>Your choices</H2>
      <P>
        Because we only use essential cookies, disabling them through your browser settings will
        prevent the Service from working correctly. You can clear cookies at any time through your
        browser settings — this will log you out of your account.
      </P>

      <H2>Changes to this policy</H2>
      <P>
        We may update this Cookie Policy if we add new functionality. We will update the &quot;Last
        updated&quot; date and, where required by law, notify you.
      </P>

      <H2>Contact</H2>
      <P>
        Questions? Email us at{' '}
        <a href={`mailto:${CONTACT}`} className="underline">{CONTACT}</a>.
      </P>
    </LegalPage>
  )
}
