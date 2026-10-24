// Cleaning a WhatsApp message before anything reads it.
//
// Text copied out of WhatsApp — a forwarded brief, a saved contact's number —
// carries characters nobody can see. A real one, from an agent who spent half an
// hour failing to add a client:
//
//   "phone: 76116<U+00A0>652<U+202C>"
//
// a non-breaking space where the space should be, and a bidirectional-text
// marker on either side, put there by WhatsApp so the number renders
// left-to-right inside Arabic text. Every rule that looked for a phone number
// missed it, so the bot asked "What's their phone number?" straight after being
// given one — eleven times.
//
// Fixing that in one parser would leave the same trap in all the others
// (budgets, names, areas), so the text is cleaned once, where it enters.

// Formatting-only characters with no meaning of their own:
//   200E/200F  left-to-right / right-to-left marks
//   202A–202E  bidi embeddings and overrides (LRE, RLE, PDF, LRO, RLO)
//   2066–2069  bidi isolates (LRI, RLI, FSI, PDI)
//   061C       Arabic letter mark
//   200B       zero-width space
//   2060       word joiner
//   FEFF       byte-order mark / zero-width no-break space
//
// Deliberately NOT removed: 200C and 200D (zero-width non-joiner / joiner).
// They hold emoji sequences together and can matter for script shaping, and
// they have never been seen breaking a parser here.
const INVISIBLE = /[‎‏‪-‮⁦-⁩؜​⁠﻿]/g

// Spaces that look like a space but are not ASCII 32: no-break, the en/em/thin
// family, narrow no-break, medium mathematical, ideographic.
const ODD_SPACES = /[  -   　]/g

/**
 * The message as the bot should read it: invisible formatting removed and every
 * kind of space made an ordinary one. Nothing else changes.
 *
 * In particular the layout is left alone — line breaks, blank lines and any
 * indentation. Agents send briefs one field per line and the form parser relies
 * on that to tell "Phone:" from "Request:", and a description's own spacing is
 * the agent's to keep.
 */
export function cleanInboundText(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFC')            // canonical composition only; NFKC would turn "m²" into "m2"
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .replace(/\r\n?/g, '\n')
    .trim()
}
