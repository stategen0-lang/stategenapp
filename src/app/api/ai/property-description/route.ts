import { NextRequest, NextResponse } from 'next/server'
import { generateDescription, type DescriptionInput } from '@/lib/ai/property-description'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as DescriptionInput & { template?: string }
    const { template, ...data } = body

    // retry on empty; no deadline — a web request can take as long as it needs.
    const description = await generateDescription(data, template, { retry: true })
    if (!description) {
      return NextResponse.json(
        { error: 'The model returned an empty description. Please try again.' },
        { status: 502 },
      )
    }
    return NextResponse.json({ description })
  } catch (err) {
    console.error('[ai/property-description]', err)
    const message = err instanceof Error ? err.message : 'Failed to generate description'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
