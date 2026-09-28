// A Supabase stand-in for testing the bot's write flows.
//
// The handlers take a SupabaseClient and do real work with it, so until now
// none of them could be tested at all — the whole confirm-then-write path, the
// part that actually changes an agency's data, ran only in production.
//
// This implements the slice of the query builder those handlers use: select /
// insert / update / delete, the eq + ilike filters, order, limit, maybeSingle,
// single, and awaiting the builder directly. Every write is recorded so a test
// can assert what would have hit the database.
//
// Deliberately small. It is not a database; it is enough of one to prove that a
// handler asks for the right rows and writes the right columns.

const norm = v => (v === null || v === undefined ? v : typeof v === 'number' ? v : String(v))

/** @param {Record<string, object[]>} tables seed rows, by table name */
export function fakeDb(tables = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.map(r => ({ ...r }))]))
  /** Every write attempted, in order: { table, op, values, filters }. */
  const writes = []

  const from = (table) => {
    data[table] ??= []
    const filters = []
    let op = 'select'
    let values = null
    let limit = Infinity
    let order = null

    const rows = () => {
      let out = data[table].filter(row =>
        filters.every(([kind, col, val]) => kind === 'ilike'
          ? String(row[col] ?? '').toLowerCase().includes(String(val).replace(/%/g, '').toLowerCase())
          : norm(row[col]) === norm(val)))
      if (order) {
        const { col, ascending } = order
        out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1))
      }
      return out.slice(0, limit)
    }

    const run = () => {
      if (op === 'select') return { data: rows(), error: null }
      writes.push({ table, op, values, filters: filters.map(([, c, v]) => [c, v]) })
      if (op === 'insert') {
        const added = (Array.isArray(values) ? values : [values]).map((v, i) => ({ id: data[table].length + i + 1, ...v }))
        data[table].push(...added)
        return { data: added, error: null }
      }
      if (op === 'update') {
        const hit = rows()
        for (const row of hit) Object.assign(row, values)
        return { data: hit, error: null }
      }
      if (op === 'delete') {
        const hit = new Set(rows())
        data[table] = data[table].filter(r => !hit.has(r))
        return { data: [...hit], error: null }
      }
      return { data: null, error: null }
    }

    const api = {
      select() { if (op === 'select') op = 'select'; return api },
      insert(v) { op = 'insert'; values = v; return api },
      update(v) { op = 'update'; values = v; return api },
      upsert(v) { op = 'insert'; values = v; return api },
      delete() { op = 'delete'; return api },
      eq(col, val) { filters.push(['eq', col, val]); return api },
      ilike(col, val) { filters.push(['ilike', col, val]); return api },
      order(col, o = {}) { order = { col, ascending: o.ascending !== false }; return api },
      limit(n) { limit = n; return api },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      single() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
      // Awaiting the builder itself runs it — which is how most of the handlers
      // are written.
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return api
  }

  return {
    client: { from },
    /** Rows as they stand now. */
    table: (name) => data[name] ?? [],
    /** Every write attempted, for asserting what reached the database. */
    writes,
    writesTo: (name, op) => writes.filter(w => w.table === name && (!op || w.op === op)),
  }
}
