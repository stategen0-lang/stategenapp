import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { VIDEO_BUCKET, MAX_VIDEO_BYTES, VIDEO_MIME_TYPES, videoPath } from '@/lib/upload'

// Mint a one-time signed upload URL so the browser can send a raw walkthrough
// video STRAIGHT to Supabase Storage, bypassing the ~4.5 MB Serverless request
// limit. Our server only issues the token — the bytes never pass through it.
//
// The public bucket enforces the real size/type limits, so a client that skips
// its own checks still can't upload something oversized or non-video.

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.storage.getBucket(VIDEO_BUCKET)
  if (data) return
  await admin.storage.createBucket(VIDEO_BUCKET, {
    public: true,
    fileSizeLimit: MAX_VIDEO_BYTES,
    allowedMimeTypes: VIDEO_MIME_TYPES,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let ext = 'mp4'
  try {
    const body = await req.json()
    if (typeof body?.ext === 'string') ext = body.ext
  } catch { /* default extension */ }

  const admin = createAdminClient()
  try { await ensureBucket(admin) } catch (e) { console.error('[upload/video] ensureBucket', e) }

  const path = videoPath(session.companyId, ext)
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[upload/video] sign error', error)
    return NextResponse.json({ error: 'Could not start the upload. Try again.' }, { status: 500 })
  }

  const { data: pub } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(path)
  return NextResponse.json({ path: data.path, token: data.token, url: pub.publicUrl }, { status: 201 })
}
