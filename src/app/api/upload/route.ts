import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateUpload, photoPath, PHOTO_BUCKET } from '@/lib/upload'

// Upload a property photo to Storage and return its public URL.
//
// Goes through the server, not straight from the browser, so we can:
//   • require a signed-in session (an anonymous visitor can't fill the bucket),
//   • check the file's real bytes, not the browser's claimed Content-Type, and
//   • keep the storage write on the service role, so the bucket needs no
//     public write policy.

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = validateUpload(bytes)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const path = photoPath(session.companyId, check.ext!)
  const admin = createAdminClient()
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: check.mime,
    // Names are random, so a collision is a bug, not something to overwrite.
    upsert: false,
  })
  if (error) {
    console.error('[upload] storage error', error)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }

  const { data } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl }, { status: 201 })
}
