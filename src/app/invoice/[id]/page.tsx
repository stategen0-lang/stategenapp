import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import PrintButton from '@/components/invoice/PrintButton'

// Public, read-only invoice page. The operator shares stategen.app/invoice/<id>;
// the invoice id is a random UUID (unguessable, not enumerable), so the link is
// the secret. Loaded server-side with the admin client; noindex so it never gets
// crawled.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice — StateGen', robots: { index: false, follow: false } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const money = (n: unknown) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

type Row = Record<string, unknown>

async function load(id: string): Promise<{ inv: Row; company: Row | null } | null> {
  if (!UUID.test(id)) return null
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
  if (!inv) return null
  const { data: company } = await admin.from('Companies').select('Name, domain').eq('id', (inv as Row).company_id).maybeSingle()
  return { inv: inv as Row, company: (company as Row) ?? null }
}

const H = '#14223F'
const SUB = '#7A8499'

function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F5F7', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontWeight: 700, color: H, fontSize: 18 }}>Invoice not found</p>
        <p style={{ color: SUB, fontSize: 14, marginTop: 6 }}>This link may be mistyped or no longer valid.</p>
      </div>
    </main>
  )
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await load(id)
  if (!data) return <NotFound />
  const { inv, company } = data

  const status = String(inv.status ?? 'unpaid')
  const sub = (inv.subtotal as number) ?? (inv.amount as number)
  const disc = Number(inv.discount_pct ?? 0)
  const badge = status === 'paid' ? { bg: '#E3F4EA', fg: '#1F7A4D' } : status === 'void' ? { bg: '#F1F1F1', fg: '#777' } : { bg: '#FBEFD6', fg: '#9A6516' }
  const created = inv.created_at ? new Date(inv.created_at as string).toLocaleDateString() : ''

  return (
    <main style={{ minHeight: '100vh', background: '#F4F5F7', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '40px 20px' }}>
      <style>{`@media print { body { background: #fff; } .no-print { display: none !important; } .sheet { box-shadow: none !important; margin: 0 !important; } }`}</style>
      <div className="sheet" style={{ maxWidth: 620, margin: '0 auto', background: '#fff', borderRadius: 16, padding: 40, boxShadow: '0 2px 16px rgba(20,34,63,0.08)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: H, letterSpacing: '-0.5px' }}>StateGen</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: SUB }}>Real estate CRM</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontWeight: 800, color: H }}>{String(inv.number ?? 'Invoice')}</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: SUB }}>{created}</p>
            <span style={{ display: 'inline-block', marginTop: 8, background: badge.bg, color: badge.fg, padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{status.toUpperCase()}</span>
          </div>
        </div>

        {/* Billed to */}
        <div style={{ marginTop: 28 }}>
          <p style={{ margin: 0, fontSize: 12, color: SUB }}>Billed to</p>
          <p style={{ margin: '4px 0 0', fontWeight: 700, color: H, fontSize: 15 }}>{String(company?.Name ?? '')}</p>
          {company?.domain ? <p style={{ margin: '2px 0 0', fontSize: 13, color: SUB }}>{String(company.domain)}</p> : null}
        </div>

        {/* Lines */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 28 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 0', borderBottom: '1px solid #EEF0F4', fontSize: 12, color: SUB }}>DESCRIPTION</th>
              <th style={{ textAlign: 'right', padding: '10px 0', borderBottom: '1px solid #EEF0F4', fontSize: 12, color: SUB }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '12px 0', borderBottom: '1px solid #F4F5F8', color: H, fontSize: 14 }}>
                {cap(String(inv.plan ?? ''))} plan
                {inv.period_start && inv.period_end ? <span style={{ color: SUB }}> · {String(inv.period_start)} → {String(inv.period_end)}</span> : null}
              </td>
              <td style={{ padding: '12px 0', borderBottom: '1px solid #F4F5F8', textAlign: 'right', color: H, fontSize: 14 }}>{money(sub)}</td>
            </tr>
            {disc > 0 && (
              <tr>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #F4F5F8', color: '#1F7A4D', fontSize: 14 }}>Discount ({disc}%)</td>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #F4F5F8', textAlign: 'right', color: '#1F7A4D', fontSize: 14 }}>-{money(Number(sub) - Number(inv.amount))}</td>
              </tr>
            )}
            <tr>
              <td style={{ padding: '14px 0', fontWeight: 800, color: H, fontSize: 18 }}>Total {status === 'paid' ? 'paid' : 'due'}</td>
              <td style={{ padding: '14px 0', textAlign: 'right', fontWeight: 800, color: H, fontSize: 18 }}>{money(inv.amount)}</td>
            </tr>
          </tbody>
        </table>

        {inv.note ? <p style={{ marginTop: 20, fontSize: 13, color: SUB }}>{String(inv.note)}</p> : null}
        {inv.method ? <p style={{ marginTop: 8, fontSize: 13, color: SUB }}>Payment method: {String(inv.method)}</p> : null}

        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#9AA3B2' }}>Thank you.</p>
          <PrintButton />
        </div>
      </div>
    </main>
  )
}
