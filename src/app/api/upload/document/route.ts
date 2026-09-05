import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateDocument, documentPath, DOC_BUCKET, MAX_DOC_BYTES } from '@/lib/upload'

// Upload a PRIVATE property document (deed, contract, ID scan) to a private
// Storage bucket and return only its path — never a public URL. The file is
// later served through /api/properties/document, which re-checks that the
// caller is the listing's agent or a manager and issues a short-lived signed
// URL. A leaked path on its own therefore grants no access.

// Create the private bucket on first use so no manual Supabase step is needed.
// It is idempotent — a "already exists" error is expected and ignored.
async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.storage.getBucket(DOC_BUCKET)
  if (data) return
  await admin.storage.createBucket(DOC_BUCKET, {
    public: false,
    fileSizeLimit: MAX_DOC_BYTES,
  })
}

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
  const check = validateDocument(bytes)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const admin = createAdminClient()
  try { await ensureBucket(admin) } catch (e) { console.error('[upload/document] ensureBucket', e) }

  const path = documentPath(session.companyId, check.ext!)
  const { error } = await admin.storage.from(DOC_BUCKET).upload(path, bytes, {
    contentType: check.mime,
    upsert: false,
  })
  if (error) {
    console.error('[upload/document] storage error', error)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }

  // Return the storage path and the original filename (for display only).
  return NextResponse.json({ path, name: file.name || `document.${check.ext}` }, { status: 201 })
}
