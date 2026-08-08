import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'

// Daily cron: find companies expiring in 3 days or today, email the manager.
// Vercel invokes this with the CRON_SECRET header.

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'StateGen <billing@stategenapp.vercel.app>'

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron, not a random request
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Find companies with access_until = today OR 3 days from now
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const in3Days = new Date(today)
  in3Days.setDate(in3Days.getDate() + 3)

  const fmt = (d: Date) => d.toISOString().slice(0, 10)  // YYYY-MM-DD

  // Fetch companies expiring on either target date
  const { data: companies, error } = await admin
    .from('Companies')
    .select('id, Name, domain, access_until')
    .in('access_until', [fmt(today), fmt(in3Days)])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!companies || companies.length === 0) return NextResponse.json({ sent: 0 })

  let sent = 0
  const errors: string[] = []

  for (const company of companies) {
    // Get the owner profile
    const { data: profile } = await admin
      .from('Profiles')
      .select('id, Full_name')
      .eq('company_id', company.id)
      .eq('role', 'owner')
      .maybeSingle()

    if (!profile) continue

    // Get the owner's email from auth
    const { data: authUser } = await admin.auth.admin.getUserById(profile.id)
    const email = authUser?.user?.email
    if (!email) continue

    const expiresOn = new Date(company.access_until)
    const isToday = fmt(expiresOn) === fmt(today)
    const daysLeft = isToday ? 0 : 3

    const subject = isToday
      ? `⚠️ Your StateGen subscription expires today — ${company.Name}`
      : `Reminder: Your StateGen subscription expires in 3 days — ${company.Name}`

    const body = isToday
      ? `Hi ${profile.Full_name},\n\nYour StateGen subscription for ${company.Name} (${company.domain}) expires today.\n\nYour agents will lose access to the platform at midnight. Please contact us to renew your subscription and keep your account active.\n\nReply to this email or reach out directly to continue.\n\n— StateGen`
      : `Hi ${profile.Full_name},\n\nThis is a reminder that your StateGen subscription for ${company.Name} (${company.domain}) expires in 3 days, on ${expiresOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.\n\nPlease arrange payment before then to avoid any interruption for your agents.\n\nReply to this email or reach out directly to renew.\n\n— StateGen`

    const { error: mailErr } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      text: body,
    })

    if (mailErr) {
      errors.push(`${email}: ${mailErr.message}`)
    } else {
      sent++
    }
  }

  return NextResponse.json({ sent, errors: errors.length ? errors : undefined })
}
