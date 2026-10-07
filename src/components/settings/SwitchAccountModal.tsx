'use client'

import { useEffect } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import { tagStyle } from '@/lib/data'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { initialsOf, type SavedAccount } from '@/lib/saved-accounts'

// The small "Switch account" window: the accounts this device has signed in
// with, and "Add account". Picking one signs out and opens the sign-in form with
// that account pre-filled — the person still types the password, because nothing
// secret is ever kept on the device.

const H = '#14223F'
const SUB = '#7A8499'

export default function SwitchAccountModal({
  accounts, isCurrent, busy, onPick, onAdd, onRemove, onClose,
}: {
  accounts: SavedAccount[]
  isCurrent: (a: SavedAccount) => boolean
  busy: boolean
  onPick: (a: SavedAccount) => void
  onAdd: () => void
  onRemove: (a: SavedAccount) => void
  onClose: () => void
}) {
  useLockBodyScroll()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(14,31,61,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
        role="dialog" aria-modal="true" aria-label="Switch account"
      >
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <div>
            <p className="text-base font-bold" style={{ color: H }}>Switch account</p>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Accounts used on this device.</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50">
            <X className="h-4 w-4" style={{ color: '#9AA3B2' }} />
          </button>
        </div>

        <div className="p-3 space-y-1.5 max-h-[55vh] overflow-y-auto">
          {accounts.map(a => {
            const current = isCurrent(a)
            const tone = tagStyle(a.id.toLowerCase())
            return (
              <div key={a.id} className="flex items-center gap-1">
                <button
                  onClick={() => { if (!current) onPick(a) }}
                  disabled={busy || current}
                  className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors enabled:hover:bg-gray-50 disabled:cursor-default"
                  style={{ border: current ? '1.5px solid #CDE7D6' : '1.5px solid #EEF0F4', background: current ? '#F1F8F3' : '#fff' }}
                >
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: tone.bg, color: tone.color }}>
                    {initialsOf(a.name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate" style={{ color: H }}>{a.name}</span>
                    <span className="block text-xs truncate" style={{ color: SUB }}>{a.id}</span>
                  </span>
                  {current
                    ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: '#E3F4EA', color: '#1F7A4D' }}>Signed in</span>
                    : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#9AA3B2' }} />}
                </button>
                {!current && (
                  <button
                    onClick={() => onRemove(a)} disabled={busy}
                    aria-label={`Forget ${a.name}`} title="Forget this account on this device"
                    className="p-2 rounded-lg hover:bg-red-50 disabled:opacity-50 shrink-0"
                  >
                    <X className="h-3.5 w-3.5" style={{ color: '#A23434' }} />
                  </button>
                )}
              </div>
            )
          })}

          <button
            onClick={onAdd} disabled={busy}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-gray-50 disabled:opacity-60"
            style={{ border: '1.5px dashed #C4CAD6' }}
          >
            <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#EAF0FA' }}>
              <Plus className="h-4 w-4" style={{ color: '#2E5288' }} />
            </span>
            <span className="text-sm font-semibold" style={{ color: H }}>Add account</span>
          </button>
        </div>

        <p className="px-5 pb-4 text-[11px]" style={{ color: SUB }}>
          You&apos;ll be signed out, then enter the password for the account you choose. Passwords are never saved here.
        </p>
      </div>
    </div>
  )
}
