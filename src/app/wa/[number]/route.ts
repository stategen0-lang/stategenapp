import { NextResponse } from 'next/server'

// Click-to-chat redirect. WhatsApp templates forbid a wa.me URL in a button, so
// the "Message client" button on the new-client notification points here
// (https://stategen.app/wa/<number>) and we 302 to wa.me. The agent taps it and
// the client's chat opens in the agent's own WhatsApp — the bot never messages
// the client (see the client-contact product rule). Public (allowlisted in
// proxy.ts): the number is already in the message the agent received.
export async function GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const digits = String(number ?? '').replace(/\D/g, '')
  const target = digits ? `https://wa.me/${digits}` : 'https://wa.me/'
  return NextResponse.redirect(target, 302)
}
