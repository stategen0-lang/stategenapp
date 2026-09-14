// Reading "send #45 to marketing" over WhatsApp. Pure. Run: npm test

/**
 * The listing an agent asks to send to the marketing team: "send #45 to
 * marketing", "marketing 45", "email listing 45 to marketing", "#45 marketing".
 * Needs the word "marketing" and a listing number, so nothing else is caught.
 */
export function parseMarketingRequest(text: string | null | undefined): number | null {
  const s = String(text ?? '').trim()
  if (!s || s.includes('\n') || s.length > 80 || !/\bmarketing\b/i.test(s)) return null
  // Asking about it isn't sending it.
  if (/\?\s*$/.test(s) || /^(did|was|has|have|is|when)\b/i.test(s)) return null
  const m = s.match(/#\s*(\d{1,9})\b/)
    || s.match(/\b(?:listing|property|prop|unit)\s*#?\s*(\d{1,9})\b/i)
    || s.match(/^(?:send|email|mail|forward|share)\s+(\d{1,9})\b/i)
    || s.match(/\bmarketing\s+(\d{1,9})\s*$/i)
  return m ? Number(m[1]) : null
}

/**
 * "send it to marketing", "send to marketing", "marketing" — no listing number.
 * Used with the listing the agent opened (listing-finder).
 */
export function isMarketingRequestWithoutId(text: string | null | undefined): boolean {
  const s = String(text ?? '').trim()
  if (!s || s.length > 50 || /\d/.test(s)) return false
  return /^(?:send|email|mail|forward|share)?\s*(?:it|this|this\s+one|this\s+listing|the\s+listing|listing|property)?\s*(?:to\s+)?(?:the\s+)?marketing(?:\s+team)?\s*(?:please|pls)?[.!?]*$/i.test(s)
}
