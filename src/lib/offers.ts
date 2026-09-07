// Offer & negotiation tracking — the pure part.
//
// A negotiation on a deal is a sequence of rounds (buyer offer, owner counter,
// buyer counter, …). Its live state — the amount on the table, whose turn it is,
// and whether it's still open or settled — is DERIVED from the rounds, so there
// is nothing to keep in sync. No imports, so the unit-test runner loads it.

export type OfferSide = 'buyer' | 'owner'
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export interface OfferRound {
  id: string
  amount: number
  side: OfferSide
  status: OfferStatus
  note?: string | null
  at: string            // ISO
  by?: string | null    // agent_code who logged it
}

export type NegotiationStatus = 'none' | 'open' | 'accepted' | 'rejected' | 'withdrawn'

export interface NegotiationState {
  status: NegotiationStatus
  currentAmount: number | null   // the latest amount on the table
  currentSide: OfferSide | null  // who put it there
  turn: OfferSide | null         // whose move it is now (only while open)
  count: number
  rounds: OfferRound[]           // oldest → newest
}

export function otherSide(s: OfferSide): OfferSide {
  return s === 'buyer' ? 'owner' : 'buyer'
}

/** Derive the live state of a negotiation from its rounds. */
export function negotiationState(rounds: OfferRound[]): NegotiationState {
  const sorted = [...rounds].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  if (!sorted.length) {
    return { status: 'none', currentAmount: null, currentSide: null, turn: null, count: 0, rounds: [] }
  }
  // A settled round (accepted/rejected/withdrawn) ends the negotiation.
  const settled = [...sorted].reverse().find(r => r.status !== 'pending')
  if (settled) {
    return {
      status: settled.status as NegotiationStatus,
      currentAmount: settled.amount, currentSide: settled.side, turn: null,
      count: sorted.length, rounds: sorted,
    }
  }
  const last = sorted[sorted.length - 1]
  return {
    status: 'open', currentAmount: last.amount, currentSide: last.side,
    turn: otherSide(last.side), count: sorted.length, rounds: sorted,
  }
}

export const NEGOTIATION_LABEL: Record<NegotiationStatus, string> = {
  none: 'No offers', open: 'In negotiation', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

export function sideLabel(s: OfferSide): string {
  return s === 'buyer' ? 'Buyer' : 'Owner'
}

/** "$465,000" */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** "3% below asking" / "at asking" / "5% above asking", or '' if no asking. */
export function vsAsking(amount: number, asking: number | null | undefined): string {
  if (!asking || asking <= 0) return ''
  const pct = Math.round(((amount - asking) / asking) * 100)
  if (pct === 0) return 'at asking'
  return `${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} asking`
}

/** A one-line status for the WhatsApp bot. */
export function negotiationLine(s: NegotiationState, opts: { asking?: number | null } = {}): string {
  if (s.status === 'none' || s.currentAmount == null) return 'No offers yet.'
  const vs = vsAsking(s.currentAmount, opts.asking)
  const tail = vs ? ` (${vs})` : ''
  if (s.status === 'open') {
    return `${money(s.currentAmount)} on the table${tail} — ${sideLabel(s.currentSide!)}'s last move, ${sideLabel(s.turn!)} to respond.`
  }
  return `${NEGOTIATION_LABEL[s.status]} at ${money(s.currentAmount)}${tail}.`
}
