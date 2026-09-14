'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'

// "Delete listing" / "Delete client" at the foot of an edit form. Deleting is
// permanent, so it takes two taps: the first reveals what will be removed, the
// second does it. The server re-checks who may delete.

export default function DeleteRecord({ noun, name, consequence, endpoint, onDeleted }: {
  /** "listing" or "client". */
  noun: string
  /** Shown in the confirmation, e.g. the listing title or client name. */
  name: string
  /** What else goes with it, in one sentence. */
  consequence: string
  /** DELETE URL, e.g. /api/properties?id=45. */
  endpoint: string
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    setBusy(true); setError('')
    try {
      const res = await fetch(endpoint, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Could not delete this ${noun}. Please try again.`); setBusy(false); return }
      onDeleted()
    } catch {
      setError('Network error. Please try again.'); setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: '#A23434' }}>
        <Trash2 className="h-3.5 w-3.5" /> Delete {noun}
      </button>
    )
  }

  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: '#FBE7E7', border: '1px solid #F0C4C4' }}>
      <p className="text-sm font-bold" style={{ color: '#7A2020' }}>Delete &ldquo;{name}&rdquo; permanently?</p>
      <p className="text-xs mt-1" style={{ color: '#7A2020' }}>{consequence} This can&apos;t be undone.</p>
      {error && <p className="text-xs mt-2 font-semibold" style={{ color: '#A23434' }}>{error}</p>}
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={() => { setConfirming(false); setError('') }} disabled={busy}
          className="flex-1 rounded-lg py-2 text-xs font-semibold" style={{ background: '#fff', border: '1.5px solid #F0C4C4', color: '#6A7488' }}>
          Keep it
        </button>
        <button type="button" onClick={remove} disabled={busy}
          className="flex-1 rounded-lg py-2 text-xs font-bold text-white disabled:opacity-60" style={{ background: '#A23434' }}>
          {busy ? 'Deleting…' : `Delete ${noun}`}
        </button>
      </div>
    </div>
  )
}
