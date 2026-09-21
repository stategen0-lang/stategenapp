import { NextRequest, NextResponse } from 'next/server'
import { generateArabicDescription, type DescriptionInput } from '@/lib/ai/property-description'
import { getSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  // Same guard as the English generator: this spends xAI credits, so it is
  // never open to anyone who is not signed in.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as DescriptionInput & { description?: string }
    const { description, ...data } = body
    if (!String(description ?? '').trim()) {
      return NextResponse.json({ error: 'Write the English description first.' }, { status: 400 })
    }

    const arabic = await generateArabicDescription(String(description), data, { retry: true })
    if (!arabic) {
      return NextResponse.json(
        { error: 'The model did not return an Arabic version. Please try again.' },
        { status: 502 },
      )
    }
    return NextResponse.json({ arabic })
  } catch (err) {
    console.error('[ai/property-description/arabic]', err)
    const message = err instanceof Error ? err.message : 'Failed to generate the Arabic version'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
