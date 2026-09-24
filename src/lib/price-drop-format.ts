// How a price cut is written down.
//
// Separate from price-drop.ts, which decides who gets alerted, because that one
// pulls in the whole matching engine — and the alerts page only wants to print
// a line. A leaf module with no imports keeps the engine out of the browser
// bundle.

/** How far the price fell, as a percentage of what it was. 0 when it rose. */
export function dropPercent(oldPrice: number, newPrice: number): number {
  const from = Number(oldPrice) || 0
  const to = Number(newPrice) || 0
  if (from <= 0 || to <= 0 || to >= from) return 0
  return ((from - to) / from) * 100
}

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`

/** "$480,000 → $450,000 (6% off)" — the whole story in one line. */
export function dropLine(oldPrice: number, newPrice: number, isRent = false): string {
  const pct = Math.round(dropPercent(oldPrice, newPrice))
  const per = isRent ? '/mo' : ''
  return `${money(oldPrice)}${per} → ${money(newPrice)}${per}${pct > 0 ? ` (${pct}% off)` : ''}`
}
