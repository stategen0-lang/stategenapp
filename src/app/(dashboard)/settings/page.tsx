'use client'

import { useState } from 'react'
import { TrendingUp, DollarSign, Home, BadgeDollarSign, X, ChevronRight } from 'lucide-react'
import { DEALS, getAgent, formatPrice, Deal, typeStyle } from '@/lib/data'

const COMMISSION_RATE = 2.5
const MY_AGENT_ID = 'a1'
const H   = '#1A2B4A'
const SUB = '#7A8499'

type KpiKey = 'sold' | 'rented' | 'volume' | 'commission'

const YEARS = [2026, 2025, 2024, 2023]

function yearOf(d: Deal) { return new Date(d.date).getFullYear() }

export default function ProfilePage() {
  const agent   = getAgent(MY_AGENT_ID)
  const myDeals = DEALS.filter(d => d.agentId === MY_AGENT_ID)
  const mySold  = myDeals.filter(d => d.transaction === 'Sale')
  const myRented = myDeals.filter(d => d.transaction === 'Rent')

  const salesVolumeYTD  = mySold.filter(d => yearOf(d) === 2026).reduce((s, d) => s + d.value, 0)
  const commissionYTD   = salesVolumeYTD * (COMMISSION_RATE / 100)

  const [kpiPanel,    setKpiPanel]   = useState<KpiKey | null>(null)
  const [dealModal,   setDealModal]  = useState<Deal | null>(null)
  const [volumeYear,  setVolumeYear] = useState<number | null>(2026)

  function toggleKpi(k: KpiKey) { setKpiPanel(p => p === k ? null : k) }

  const kpis: { key: KpiKey; label: string; value: string | number; sub: string; subColor: string; iconBg: string; iconFg: string; Icon: React.ElementType }[] = [
    { key: 'sold',       label: 'Properties sold',   value: mySold.length,                      sub: 'All time',            subColor: '#2E5288', iconBg: '#EAF0FA', iconFg: '#2E5288', Icon: Home           },
    { key: 'rented',     label: 'Properties rented', value: myRented.length,                    sub: 'All time',            subColor: '#1F7A4D', iconBg: '#E3F4EA', iconFg: '#1F8A5B', Icon: TrendingUp     },
    { key: 'volume',     label: 'Sales volume YTD',  value: formatPrice(salesVolumeYTD),        sub: '↑ vs last year',      subColor: '#1F7A4D', iconBg: '#FBEFD6', iconFg: '#9A6516', Icon: DollarSign     },
    { key: 'commission', label: 'Commission YTD',    value: `$${Math.round(commissionYTD/1000)}K`, sub: `@ ${COMMISSION_RATE}% rate`, subColor: '#1F7A4D', iconBg: '#FBE7E7', iconFg: '#A23434', Icon: BadgeDollarSign },
  ]

  // ── derived for panels ──
  const soldByYear  = YEARS.map(yr => ({ yr, deals: mySold.filter(d  => yearOf(d) === yr) }))
  const rentByYear  = YEARS.map(yr => ({ yr, deals: myRented.filter(d => yearOf(d) === yr) }))
  const maxYearVol  = Math.max(...soldByYear.map(y => y.deals.reduce((s, d) => s + d.value, 0)), 1)

  function DealRow({ d, showRent = false }: { d: Deal; showRent?: boolean }) {
    const comm = d.value * (COMMISSION_RATE / 100)
    return (
      <div
        onClick={() => setDealModal(d)}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        style={{ borderBottom: '1px solid #F4F5F8' }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: H }}>{d.propTitle}</p>
          <p className="text-xs" style={{ color: SUB }}>
            {d.location} · {new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={typeStyle(d.type)}>
          {d.type}
        </span>
        <p className="text-sm font-semibold shrink-0" style={{ color: H }}>
          {showRent ? `${formatPrice(d.value)}/yr` : formatPrice(d.value)}
        </p>
        <p className="text-xs font-medium shrink-0" style={{ color: '#1F7A4D' }}>
          +{formatPrice(Math.round(comm))}
        </p>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: '#C4CAD6' }} />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: agent.color }}>
          {agent.initials}
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>{agent.name}</h1>
          <p className="text-sm mt-0.5" style={{ color: SUB }}>Senior Agent · Meridian Estates</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {kpis.map(({ key, label, value, sub, subColor, iconBg, iconFg, Icon }) => (
          <div
            key={key}
            onClick={() => toggleKpi(key)}
            className="rounded-2xl p-5 bg-white cursor-pointer transition-all"
            style={{
              boxShadow: kpiPanel === key ? '0 0 0 2px #5E8FD6, 0 2px 8px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.06)',
              border: kpiPanel === key ? '1px solid #5E8FD6' : '1px solid #EEF0F4',
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: iconBg }}>
              <Icon className="h-5 w-5" style={{ color: iconFg }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>{value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: SUB }}>{label}</p>
            <p className="text-xs mt-1 font-medium" style={{ color: subColor }}>{sub}</p>
            <p className="text-xs mt-2 font-semibold" style={{ color: '#5E8FD6' }}>Click to view →</p>
          </div>
        ))}
      </div>

      {/* ── Properties Sold — history by year ── */}
      {kpiPanel === 'sold' && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: H }}>Properties Sold — All Years</p>
              <p className="text-xs mt-0.5" style={{ color: SUB }}>{mySold.length} sales · {formatPrice(mySold.reduce((s, d) => s + d.value, 0))} total volume</p>
            </div>
            <button onClick={() => setKpiPanel(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
          </div>
          {soldByYear.map(({ yr, deals }) => deals.length > 0 && (
            <div key={yr}>
              <div className="flex items-center justify-between px-5 py-2.5" style={{ background: '#F7F8FB', borderBottom: '1px solid #EEF0F4' }}>
                <p className="text-xs font-bold" style={{ color: H }}>{yr}</p>
                <div className="flex items-center gap-4">
                  <p className="text-xs" style={{ color: SUB }}>{deals.length} sale{deals.length > 1 ? 's' : ''}</p>
                  <p className="text-xs font-semibold" style={{ color: H }}>{formatPrice(deals.reduce((s, d) => s + d.value, 0))}</p>
                </div>
              </div>
              {deals.map(d => <DealRow key={d.id} d={d} />)}
            </div>
          ))}
        </div>
      )}

      {/* ── Properties Rented — history by year ── */}
      {kpiPanel === 'rented' && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: H }}>Properties Rented — All Years</p>
              <p className="text-xs mt-0.5" style={{ color: SUB }}>{myRented.length} rentals · {formatPrice(myRented.reduce((s, d) => s + d.value, 0))} total rental value</p>
            </div>
            <button onClick={() => setKpiPanel(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
          </div>
          {rentByYear.map(({ yr, deals }) => deals.length > 0 && (
            <div key={yr}>
              <div className="flex items-center justify-between px-5 py-2.5" style={{ background: '#F7F8FB', borderBottom: '1px solid #EEF0F4' }}>
                <p className="text-xs font-bold" style={{ color: H }}>{yr}</p>
                <div className="flex items-center gap-4">
                  <p className="text-xs" style={{ color: SUB }}>{deals.length} rental{deals.length > 1 ? 's' : ''}</p>
                  <p className="text-xs font-semibold" style={{ color: H }}>{formatPrice(deals.reduce((s, d) => s + d.value, 0))}/yr total</p>
                </div>
              </div>
              {deals.map(d => <DealRow key={d.id} d={d} showRent />)}
            </div>
          ))}
        </div>
      )}

      {/* ── Sales Volume — breakdown by year with expandable deal lists ── */}
      {kpiPanel === 'volume' && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: H }}>Sales Volume by Year</p>
              <p className="text-xs mt-0.5" style={{ color: SUB }}>Total all-time: {formatPrice(mySold.reduce((s, d) => s + d.value, 0))}</p>
            </div>
            <button onClick={() => setKpiPanel(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
          </div>
          {soldByYear.map(({ yr, deals }) => {
            const vol = deals.reduce((s, d) => s + d.value, 0)
            const pct = vol / maxYearVol * 100
            return (
              <div key={yr}>
                {/* Year bar — clickable to expand */}
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: '1px solid #EEF0F4' }}
                  onClick={() => setVolumeYear(v => v === yr ? null : yr)}
                >
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-semibold flex items-center gap-1.5" style={{ color: H }}>
                      {yr}
                      {deals.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#EAF0FA', color: '#2E5288' }}>
                          {deals.length} sale{deals.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold" style={{ color: H }}>{formatPrice(vol)}</span>
                      <ChevronRight className="h-3.5 w-3.5 transition-transform" style={{ color: '#C4CAD6', transform: volumeYear === yr ? 'rotate(90deg)' : 'none' }} />
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full" style={{ background: '#EEF0F4' }}>
                    <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, background: '#5E8FD6' }} />
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: SUB }}>
                    Commission: <span className="font-semibold" style={{ color: '#1F7A4D' }}>{formatPrice(Math.round(vol * COMMISSION_RATE / 100))}</span>
                  </p>
                </div>
                {/* Expandable deal rows */}
                {volumeYear === yr && deals.length > 0 && (
                  <div style={{ borderBottom: '1px solid #EEF0F4' }}>
                    {deals.map(d => <DealRow key={d.id} d={d} />)}
                  </div>
                )}
                {volumeYear === yr && deals.length === 0 && (
                  <p className="px-5 py-4 text-xs text-center" style={{ color: '#9AA3B2', borderBottom: '1px solid #EEF0F4' }}>No sales in {yr}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Commission YTD — per-deal breakdown ── */}
      {kpiPanel === 'commission' && (
        <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #EEF0F4' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EEF0F4' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: H }}>Commission YTD — 2026</p>
              <p className="text-xs mt-0.5" style={{ color: SUB }}>
                {mySold.filter(d => yearOf(d) === 2026).length} sales · {COMMISSION_RATE}% commission rate
              </p>
            </div>
            <button onClick={() => setKpiPanel(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
          </div>
          {/* Summary band */}
          <div className="grid grid-cols-3 divide-x" style={{ borderColor: '#EEF0F4', borderBottom: '1px solid #EEF0F4' }}>
            {[
              { label: 'Sales volume', value: formatPrice(salesVolumeYTD) },
              { label: 'Commission rate', value: `${COMMISSION_RATE}%` },
              { label: 'Total earned', value: formatPrice(Math.round(commissionYTD)) },
            ].map(({ label, value }) => (
              <div key={label} className="px-5 py-4">
                <p className="text-xs" style={{ color: SUB }}>{label}</p>
                <p className="text-base font-bold mt-0.5" style={{ color: label === 'Total earned' ? '#1F7A4D' : H }}>{value}</p>
              </div>
            ))}
          </div>
          {/* Per-deal breakdown */}
          <div className="px-5 py-3" style={{ background: '#F7F8FB', borderBottom: '1px solid #EEF0F4' }}>
            <p className="text-xs font-bold" style={{ color: H }}>Deal-by-deal</p>
          </div>
          {(() => {
            const ytdDeals = mySold.filter(d => yearOf(d) === 2026)
            let running = 0
            return ytdDeals.map(d => {
              const comm = Math.round(d.value * COMMISSION_RATE / 100)
              running += comm
              return (
                <div
                  key={d.id}
                  onClick={() => setDealModal(d)}
                  className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: '1px solid #F4F5F8' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: H }}>{d.propTitle}</p>
                    <p className="text-xs" style={{ color: SUB }}>
                      {new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · {d.clientName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: '#1F7A4D' }}>+{formatPrice(comm)}</p>
                    <p className="text-xs" style={{ color: SUB }}>Running: {formatPrice(running)}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: '#C4CAD6' }} />
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Commission rate strip */}
      <div className="rounded-2xl p-5 bg-white flex items-center justify-between" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div>
          <p className="text-sm font-bold" style={{ color: H }}>Commission Rate</p>
          <p className="text-xs mt-0.5" style={{ color: SUB }}>Applied to all closed deals</p>
        </div>
        <div className="text-2xl font-bold px-5 py-2 rounded-xl" style={{ background: '#EAF0FA', color: '#2E5288' }}>
          {COMMISSION_RATE}%
        </div>
      </div>

      {/* My Deals table */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #EEF0F4' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #EEF0F4' }}>
          <p className="text-sm font-bold" style={{ color: H }}>My Deals</p>
          <p className="text-xs mt-0.5" style={{ color: SUB }}>Click any row for full details</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#F7F8FB', borderBottom: '1px solid #EEF0F4' }}>
              {['Property', 'Date', 'Type', 'Transaction', 'Amount', 'Commission'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold" style={{ color: '#9AA3B2', letterSpacing: '0.05em' }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {myDeals.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-sm" style={{ color: '#9AA3B2' }}>No deals yet</td></tr>
            ) : myDeals.map(deal => {
              const commission = Math.round(deal.value * (COMMISSION_RATE / 100))
              const isRent = deal.transaction === 'Rent'
              return (
                <tr
                  key={deal.id}
                  onClick={() => setDealModal(deal)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{ borderBottom: '1px solid #F4F5F8' }}
                >
                  <td className="px-4 py-3 font-semibold" style={{ color: H }}>{deal.propTitle}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: SUB }}>
                    {new Date(deal.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={typeStyle(deal.type)}>
                      {deal.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: isRent ? '#E3F4EA' : '#EAF0FA', color: isRent ? '#1F7A4D' : '#2E5288' }}>
                      {deal.transaction}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold" style={{ color: H }}>
                    {formatPrice(deal.value)}{isRent ? '/yr' : ''}
                  </td>
                  <td className="px-4 py-3 font-bold" style={{ color: '#1F7A4D' }}>
                    {formatPrice(commission)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Deal detail modal */}
      {dealModal && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
          style={{ background: 'rgba(14,31,61,0.45)' }}
          onClick={e => e.target === e.currentTarget && setDealModal(null)}
        >
          <div className="w-full md:max-w-sm md:rounded-2xl rounded-t-2xl overflow-hidden bg-white" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EEF0F4' }}>
              <p className="font-semibold text-sm" style={{ color: H }}>Deal Details</p>
              <button onClick={() => setDealModal(null)} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-4 w-4" style={{ color: SUB }} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-medium mb-0.5" style={{ color: SUB }}>Property</p>
                <p className="text-base font-bold" style={{ color: H }}>{dealModal.propTitle}</p>
                <p className="text-xs" style={{ color: SUB }}>{dealModal.location}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Type',        value: dealModal.type },
                  { label: 'Transaction', value: dealModal.transaction },
                  { label: dealModal.transaction === 'Rent' ? 'Annual rent' : 'Sale price', value: formatPrice(dealModal.value) + (dealModal.transaction === 'Rent' ? '/yr' : '') },
                  { label: 'Commission',  value: formatPrice(Math.round(dealModal.value * COMMISSION_RATE / 100)) },
                  { label: 'Days to close', value: `${dealModal.days} days` },
                  { label: 'Closed',      value: new Date(dealModal.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) },
                  ...(dealModal.clientName ? [{ label: 'Client', value: dealModal.clientName }] : []),
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl p-3" style={{ background: '#F7F8FB' }}>
                    <p className="text-xs" style={{ color: SUB }}>{label}</p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color: label === 'Commission' ? '#1F7A4D' : H }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
