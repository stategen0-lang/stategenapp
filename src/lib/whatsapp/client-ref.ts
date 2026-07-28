// Parsing a client reference from a message.
//
// Two clients can share a name ("Nour Sleiman" appears twice in the seed data),
// which made "info on Nour Sleiman" a dead end — the bot said "be more specific"
// but the name WAS specific. This lets an agent add an area to pick one:
// "info on Nour Sleiman in Beit Mery". Pure and unit-tested.

export interface ClientRef {
  name: string
  /** An area qualifier the agent added to disambiguate, if any. */
  location?: string
}

/** Split "Nour Sleiman in Beit Mery" into a name and an optional area. */
export function splitClientRef(ref: string | null | undefined): ClientRef {
  const text = (ref ?? '').trim()
  if (!text) return { name: '' }

  // "<name> in <area>" — the area is letters/spaces, so "in" inside a name
  // ("Robin") won't split (needs a following area word). Take the LAST " in "
  // so "Martin in Metn" splits on the right one.
  const m = text.match(/^(.+?)\s+in\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{1,30})$/i)
  if (m) return { name: m[1].trim(), location: m[2].trim() }
  return { name: text }
}
