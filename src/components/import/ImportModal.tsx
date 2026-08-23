'use client'

import { useMemo, useRef, useState } from 'react'
import { X, UploadCloud, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react'
import { FIELDS, applyMapping, isValidRow, type ImportKind, type Mapping } from '@/lib/import/mapping'

const NAVY = '#0E1F3D', SUB = '#6A7488', LINE = '#EEF0F4'

type Analyzed = { headers: string[]; rows: string[][]; mapping: Mapping; total: number; truncated: boolean }

export default function ImportModal({ kind, onClose, onDone }: {
  kind: ImportKind
  onClose: () => void
  onDone: (inserted: number) => void
}) {
  const noun = kind === 'properties' ? 'properties' : 'clients'
  const [phase, setPhase] = useState<'pick' | 'analyzing' | 'review' | 'importing'>('pick')
  const [data, setData] = useState<Analyzed | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fields = FIELDS[kind]

  async function analyze(file: File) {
    setError(''); setPhase('analyzing')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('kind', kind)
      const r = await fetch('/api/import/analyze', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Could not read that file.'); setPhase('pick'); return }
      setData(j); setMapping(j.mapping); setPhase('review')
    } catch {
      setError('Upload failed. Please try again.'); setPhase('pick')
    }
  }

  // Live preview of the first rows using the current mapping.
  const preview = useMemo(() => {
    if (!data) return []
    return applyMapping(kind, data.headers, data.rows.slice(0, 5), mapping) as unknown as Record<string, unknown>[]
  }, [data, mapping, kind])

  const validCount = useMemo(() => {
    if (!data) return 0
    return applyMapping(kind, data.headers, data.rows, mapping).filter(o => isValidRow(kind, o)).length
  }, [data, mapping, kind])

  async function doImport() {
    if (!data) return
    setError(''); setPhase('importing')
    try {
      const r = await fetch('/api/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, headers: data.headers, rows: data.rows, mapping }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Import failed.'); setPhase('review'); return }
      onDone(j.inserted ?? 0)
    } catch {
      setError('Import failed. Please try again.'); setPhase('review')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,40,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}
        style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div>
            <h2 className="text-base font-extrabold" style={{ color: NAVY }}>Import {noun}</h2>
            <p className="text-xs mt-0.5" style={{ color: SUB }}>Upload an Excel or CSV file — StateGen maps the columns for you.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: SUB }}><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <div className="mb-4 text-sm rounded-xl px-3 py-2" style={{ background: '#FDF5F5', color: '#A23434', border: '1px solid #F3D7D7' }}>{error}</div>}

          {/* ── Pick / analyzing ── */}
          {(phase === 'pick' || phase === 'analyzing') && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={phase === 'analyzing'}
              className="w-full rounded-2xl flex flex-col items-center justify-center gap-3 py-12 px-4"
              style={{ border: `2px dashed ${LINE}`, background: '#F7F8FB', color: SUB }}
            >
              {phase === 'analyzing' ? (
                <><Loader2 className="h-8 w-8 animate-spin" style={{ color: NAVY }} /><p className="text-sm font-semibold" style={{ color: NAVY }}>Reading your file &amp; matching columns…</p></>
              ) : (
                <><UploadCloud className="h-8 w-8" style={{ color: NAVY }} /><p className="text-sm font-semibold" style={{ color: NAVY }}>Choose an Excel (.xlsx) or CSV file</p><p className="text-xs">The first row should be your column headings.</p></>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f) }} />
            </button>
          )}

          {/* ── Review mapping + preview ── */}
          {phase === 'review' && data && (
            <>
              <div className="flex items-center gap-2 mb-4 text-sm rounded-xl px-3 py-2" style={{ background: '#EFF5FF', color: '#2B5AA0' }}>
                <FileSpreadsheet className="h-4 w-4 shrink-0" />
                <span>Found <b>{data.total}</b> row{data.total === 1 ? '' : 's'}{data.truncated ? ' (first 5,000 will import)' : ''}. Check the column matches below, then import.</span>
              </div>

              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9AA3B2' }}>Column matching</p>
              <div className="space-y-2 mb-5">
                {fields.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <label className="text-sm w-40 shrink-0" style={{ color: NAVY }}>
                      {f.label}{f.required && <span style={{ color: '#C0562B' }}> *</span>}
                    </label>
                    <select
                      value={mapping[f.key] ?? ''}
                      onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || null }))}
                      className="flex-1 rounded-lg px-2 py-1.5 text-sm" style={{ border: `1.5px solid ${LINE}`, background: '#fff', color: NAVY }}
                    >
                      <option value="">— not imported —</option>
                      {data.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview */}
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9AA3B2' }}>Preview (first {preview.length})</p>
              <div className="rounded-xl overflow-x-auto" style={{ border: `1px solid ${LINE}` }}>
                <table className="text-xs w-full">
                  <thead>
                    <tr style={{ background: '#F7F8FB' }}>
                      {fields.map(f => <th key={f.key} className="text-left px-2 py-1.5 font-semibold whitespace-nowrap" style={{ color: '#9AA3B2' }}>{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                        {fields.map(f => <td key={f.key} className="px-2 py-1.5 whitespace-nowrap" style={{ color: NAVY }}>{row[f.key] == null || row[f.key] === '' ? '—' : String(row[f.key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {phase === 'importing' && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: NAVY }} />
              <p className="text-sm font-semibold" style={{ color: NAVY }}>Importing {validCount} {noun}…</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'review' && (
          <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
            <button onClick={() => { setPhase('pick'); setData(null) }} className="text-sm font-semibold" style={{ color: SUB }}>Choose a different file</button>
            <button onClick={doImport} disabled={validCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: NAVY }}>
              <CheckCircle2 className="h-4 w-4" /> Import {validCount} {noun}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
