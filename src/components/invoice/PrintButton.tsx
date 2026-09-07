'use client'

// Print / save-as-PDF control for the public invoice page. Hidden when printing.
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print"
      style={{ background: '#0E1F3D', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
    >
      Print / Save PDF
    </button>
  )
}
