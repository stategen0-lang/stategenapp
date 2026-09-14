// Outgoing email for the app (listing → marketing team, billing reminders).
//
// Sends through SMTP — the same Gmail account Supabase Auth already uses for
// signup and password-reset emails — so there is one mailbox to manage and no
// sending domain to verify. Configured by env, never hard-coded:
//
//   SMTP_HOST   smtp.gmail.com
//   SMTP_PORT   465            (465 = TLS from the start; 587 = STARTTLS)
//   SMTP_USER   stategen0@gmail.com
//   SMTP_PASS   a Google *app password* (not the account password)
//   SMTP_FROM   optional; defaults to SMTP_USER. Gmail rewrites any other
//               address back to the account, so leave it unset for Gmail.
//
// Server-only: it reads secrets from the environment.

import nodemailer, { type Transporter } from 'nodemailer'

export interface MailInput {
  to: string | string[]
  subject: string
  html?: string
  text: string
  /** Display name shown in the inbox, e.g. "Haddad Realty via StateGen". */
  fromName?: string
  replyTo?: string
  /** Files to attach. A cid makes it usable inline as <img src="cid:…">. */
  attachments?: { filename: string; content: Buffer; contentType?: string; cid?: string }[]
}

export type MailResult = { ok: true } | { ok: false; error: string; notConfigured?: boolean }

let transporter: Transporter | null = null

export function mailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function transport(): Transporter {
  if (transporter) return transporter
  const port = Number(process.env.SMTP_PORT) || 465
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // A serverless function has a hard time limit; fail clearly instead of hanging.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return transporter
}

// A display name goes inside quotes in the From header; strip anything that
// could break out of them or inject another header.
const cleanName = (s: string) => s.replace(/["\r\n<>]/g, '').trim().slice(0, 80)

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!mailConfigured()) {
    return { ok: false, notConfigured: true, error: 'Email sending is not configured on the server.' }
  }
  const address = process.env.SMTP_FROM || process.env.SMTP_USER!
  const name = cleanName(input.fromName || 'StateGen')
  try {
    await transport().sendMail({
      from: `"${name}" <${address}>`,
      to: input.to,
      subject: input.subject.replace(/[\r\n]+/g, ' '),
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Gmail's answer to a wrong or revoked app password — say what to fix.
    if (/535|Username and Password not accepted|Invalid login/i.test(msg)) {
      return { ok: false, error: 'The email account rejected the login. Check SMTP_USER and the app password (SMTP_PASS) in Vercel.' }
    }
    return { ok: false, error: msg }
  }
}
