import type { SupabaseClient } from '@supabase/supabase-js'
import { validateUpload, photoPath, PHOTO_BUCKET } from '@/lib/upload'

// Store raw image bytes (e.g. a photo an agent sent over WhatsApp) in the same
// public bucket the web upload uses, returning its public URL. Validates the
// real bytes, not a claimed type — identical posture to /api/upload.
export async function storePhotoBytes(admin: SupabaseClient, companyId: number, bytes: Uint8Array): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const check = validateUpload(bytes)
  if (!check.ok) return { ok: false, error: check.error ?? 'Not a supported image.' }

  const path = photoPath(companyId, check.ext!)
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: check.mime, upsert: false })
  if (error) return { ok: false, error: 'Upload failed.' }

  const { data } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return { ok: true, url: data.publicUrl }
}
