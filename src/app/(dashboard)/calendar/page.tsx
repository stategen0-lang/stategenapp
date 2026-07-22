'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Trash2, MapPin, Clock } from 'lucide-react'
import {
  CalendarEvent, EVENT_KINDS, EventKind, GridDay,
  monthGrid, monthLabel, monthRange, groupByDay, dayKey, parseDayKey,
  addMonths, formatRange, kindStyle, toLocalInput, nextHalfHour,
  validateEvent, WEEKDAYS,
} from '@/lib/calendar'
import { findAgent, unknownAgent, type RosterAgent } from '@/lib/agent-roster'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'

const H = '#14223F'
const SUB = '#6A7488'
const LINE = '#EEF0F4'

/** "1 event" / "3 events" — the count is nearly always 1 on a quiet month. */
function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ── Event form ───────────────────────────────────────────────────────────────
function EventForm({
  initial, day, onSave, onDelete, onClose, saving,
}: {
  initial: CalendarEvent | null
  day: string
  onSave: (draft: Record<string, unknown>) => void
  onDelete?: () => void
  onClose: () => void
  saving: boolean
}) {
  // A new event starts on the day the user clicked, at the next half-hour.
  const defaultStart = useMemo(() => {
    if (initial) return toLocalInput(new Date(initial.starts_at))
    const base = parseDayKey(day)
    const now = nextHalfHour()
    base.setHours(now.getHours(), now.getMinutes(), 0, 0)
    return toLocalInput(base)
  }, [initial, day])

  const [title, setTitle] = useState(initial?.title ?? '')
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? 'viewing')
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [endsAt, setEndsAt] = useState(
    initial ? toLocalInput(new Date(initial.ends_at)) : '',
  )
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  // Escape closes — expected of anything modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const draft = {
      title, kind, all_day: allDay,
      starts_at: startsAt ? new Date(startsAt).toISOString() : '',
      ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
      location, notes,
    }
    // Validated with the same function the API uses, so the form can't accept
    // something the server will then reject.
    const result = validateEvent(draft)
    if (!result.ok) { setErrors(result.errors); return }
    setErrors([])
    onSave(draft)
  }

  const field = 'w-full rounded-xl px-3 py-2 text-sm outline-none'
  const fieldStyle = { border: `1.5px solid ${LINE}`, background: '#FBFCFE', color: H }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(20,34,63,0.45)' }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold" style={{ color: H }}>
            {initial ? 'Edit event' : 'New event'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100">
            <X className="h-4 w-4" style={{ color: SUB }} />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ background: '#FBE7E7', color: '#A23434' }}>
            {errors.map(e => <p key={e}>{e}</p>)}
          </div>
        )}

        <label className="block text-xs font-semibold mb-1" style={{ color: SUB }}>Title</label>
        <input
          ref={titleRef} value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Viewing with Ahmed" className={field} style={fieldStyle}
        />

        <label className="block text-xs font-semibold mt-3 mb-1" style={{ color: SUB }}>Type</label>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_KINDS.map(k => (
            <button
              key={k.id} type="button" onClick={() => setKind(k.id)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
              style={{
                background: kind === k.id ? k.bg : '#F7F8FB',
                color: kind === k.id ? k.color : SUB,
                border: `1.5px solid ${kind === k.id ? k.color + '55' : 'transparent'}`,
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer" style={{ color: H }}>
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="w-4 h-4" />
          All day
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: SUB }}>
              {allDay ? 'Date' : 'Starts'}
            </label>
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? startsAt.slice(0, 10) : startsAt}
              onChange={e => setStartsAt(allDay ? `${e.target.value}T09:00` : e.target.value)}
              className={field} style={fieldStyle}
            />
          </div>
          {!allDay && (
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: SUB }}>
                Ends <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)}
                className={field} style={fieldStyle}
              />
            </div>
          )}
        </div>
        {!allDay && !endsAt && (
          <p className="text-xs mt-1" style={{ color: SUB }}>Leave blank for a one-hour event.</p>
        )}

        <label className="block text-xs font-semibold mt-3 mb-1" style={{ color: SUB }}>Location</label>
        <input value={location} onChange={e => setLocation(e.target.value)}
          placeholder="Hamra, Beirut" className={field} style={fieldStyle} />

        <label className="block text-xs font-semibold mt-3 mb-1" style={{ color: SUB }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Anything to remember" className={field} style={fieldStyle} />

        <div className="flex items-center gap-2 mt-4">
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
            style={{ background: '#2E5288' }}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add event'}
          </button>
          {onDelete && (
            // Two-step rather than a browser confirm(): deleting an event is
            // easy to do by accident on a phone, and a single tap with no
            // undo is the wrong default.
            <button
              type="button"
              onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}
              aria-label={confirmDelete ? 'Confirm delete' : 'Delete event'}
              className="px-3 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap"
              style={{ background: '#FBE7E7', color: '#A23434' }}
            >
              {confirmDelete ? 'Tap to confirm' : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// ── Event chip ───────────────────────────────────────────────────────────────
function EventChip({ event, agent, onClick }: { event: CalendarEvent; agent: RosterAgent; onClick: () => void }) {
  const k = kindStyle(event.kind)
  return (
    <button
      // Stop the click reaching the day cell, which would re-select the day
      // and fight this handler for the same state.
      onClick={e => { e.stopPropagation(); onClick() }}
      title={`${event.title} · ${formatRange(event)}${event.agentName ? ` · ${event.agentName}` : ''}`}
      className="w-full text-left rounded-md px-1.5 py-1 mb-0.5 truncate transition-opacity hover:opacity-80"
      style={{ background: k.bg, borderLeft: `3px solid ${agent.color}` }}
    >
      <span className="text-[10px] font-bold" style={{ color: k.color }}>
        {!event.all_day && <span style={{ opacity: 0.8 }}>{formatRange(event).split(' –')[0]} </span>}
        {event.title}
      </span>
    </button>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { session } = useSession()
  const manager = isManager(session?.role)

  const [month, setMonth] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [roster, setRoster] = useState<RosterAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(() => dayKey(new Date()))
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  // Same URL-backed filter as the pipeline, so a filtered calendar can be
  // refreshed or shared.
  const [agentFilter, setAgentFilter] = useState('')
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('agent') ?? ''
    if (fromUrl) setAgentFilter(fromUrl)
  }, [])

  function selectAgent(id: string) {
    setAgentFilter(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('agent', id)
    else url.searchParams.delete('agent')
    window.history.replaceState(null, '', url)
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // Discards superseded responses — paging months quickly otherwise lets an
  // older request repaint the grid with the wrong month's events.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    const { from, to } = monthRange(month)
    const params = new URLSearchParams({ from, to })
    if (agentFilter) params.set('agent', agentFilter)
    try {
      const res = await fetch(`/api/events?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (id !== requestId.current) return
        if (Array.isArray(data.events)) setEvents(data.events)
        if (Array.isArray(data.agents)) setRoster(data.agents)
      }
    } catch { /* keep what's on screen */ }
    if (id === requestId.current) setLoading(false)
  }, [month, agentFilter])

  useEffect(() => { load() }, [load])

  const grid = useMemo(() => monthGrid(month), [month])
  const byDay = useMemo(() => groupByDay(events), [events])
  const selectedEvents = byDay.get(selected) ?? []

  async function save(draft: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = editing
        ? await fetch('/api/events', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editing.id, ...draft }),
          })
        : await fetch('/api/events', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || 'Could not save the event')
        return
      }
      setFormOpen(false)
      setEditing(null)
      await load()
      showToast(editing ? 'Event updated' : 'Event added')
    } catch {
      showToast('Could not save the event')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/events?id=${encodeURIComponent(editing.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || 'Could not delete the event')
        return
      }
      setFormOpen(false)
      setEditing(null)
      await load()
      showToast('Event deleted')
    } finally {
      setSaving(false)
    }
  }

  const agentOf = (id: string | null) => findAgent(roster, id) ?? unknownAgent(id)

  function openNew(day: string) {
    setSelected(day)
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <div className="p-4 md:p-6" style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: H, letterSpacing: '-0.3px' }}>Calendar</h1>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: SUB }}>
            {loading
              ? 'Loading…'
              : manager
                ? `${plural(events.length, 'event')}${agentFilter ? ` · ${agentOf(agentFilter).name}` : ' · whole agency'} this month`
                : `${plural(events.length, 'event')} this month`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {manager && (
            <select
              value={agentFilter}
              onChange={e => selectAgent(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm font-semibold outline-none"
              style={{ border: `1.5px solid ${LINE}`, background: '#F7F8FB', color: H }}
              aria-label="Filter calendar by agent"
            >
              <option value="">All agents</option>
              {roster.map(a => (
                <option key={a.id} value={a.id}>{a.orphan ? `${a.name} — no profile` : a.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => openNew(selected)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white"
            style={{ background: '#2E5288' }}
          >
            <Plus className="h-4 w-4" /> New event
          </button>
        </div>
      </div>

      {/* Month controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100"
            style={{ border: `1.5px solid ${LINE}` }}>
            <ChevronLeft className="h-4 w-4" style={{ color: H }} />
          </button>
          <button onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Next month"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100"
            style={{ border: `1.5px solid ${LINE}` }}>
            <ChevronRight className="h-4 w-4" style={{ color: H }} />
          </button>
          <button
            onClick={() => { const now = new Date(); setMonth(now); setSelected(dayKey(now)) }}
            className="ml-1 px-3 h-9 rounded-lg text-sm font-semibold"
            style={{ border: `1.5px solid ${LINE}`, color: H }}
          >
            Today
          </button>
        </div>
        <p className="text-base font-bold" style={{ color: H }}>{monthLabel(month)}</p>
      </div>

      {/* Month grid */}
      <div className="rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${LINE}` }}>
        <div className="grid grid-cols-7">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center py-2 text-[11px] font-bold"
              style={{ color: SUB, background: '#FBFCFE', borderBottom: `1px solid ${LINE}` }}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((day: GridDay) => {
            const dayEvents = byDay.get(day.key) ?? []
            const isSelected = day.key === selected
            return (
              // A div, not a button: the event chips inside are buttons, and a
              // button inside a button is invalid HTML that breaks hydration.
              // Keyboard access is preserved with tabIndex + Enter/Space.
              <div
                key={day.key}
                role="gridcell"
                tabIndex={0}
                onClick={() => setSelected(day.key)}
                onDoubleClick={() => openNew(day.key)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(day.key) }
                }}
                className="text-left p-1 min-h-[76px] md:min-h-[96px] align-top transition-colors hover:bg-blue-50/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset"
                style={{
                  borderRight: `1px solid ${LINE}`,
                  borderBottom: `1px solid ${LINE}`,
                  background: isSelected ? '#EAF0FA' : day.inMonth ? '#fff' : '#FBFCFE',
                  opacity: day.inMonth ? 1 : 0.55,
                }}
                aria-label={`${day.key}, ${plural(dayEvents.length, 'event')}`}
              >
                <span
                  className="inline-flex items-center justify-center text-[11px] font-bold rounded-full w-5 h-5 mb-0.5"
                  style={{
                    background: day.isToday ? '#2E5288' : 'transparent',
                    color: day.isToday ? '#fff' : day.inMonth ? H : SUB,
                  }}
                >
                  {day.date.getDate()}
                </span>
                {dayEvents.slice(0, 3).map(e => (
                  <EventChip
                    key={e.id + day.key}
                    event={e}
                    agent={agentOf(e.agent_code)}
                    onClick={() => { setSelected(day.key); setEditing(e); setFormOpen(true) }}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <span className="text-[10px] font-semibold" style={{ color: SUB }}>
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected day */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: H }}>
            {parseDayKey(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <button onClick={() => openNew(selected)} className="text-xs font-bold" style={{ color: '#2E5288' }}>
            + Add on this day
          </button>
        </div>

        {selectedEvents.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ border: `1.5px dashed ${LINE}`, color: SUB }}>
            <p className="text-sm">Nothing scheduled.</p>
            <p className="text-xs mt-1">Double-click any day in the grid to add an event.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedEvents.map(e => {
              const k = kindStyle(e.kind)
              const agent = agentOf(e.agent_code)
              return (
                <div
                  key={e.id}
                  className="rounded-xl p-3 flex items-start gap-3"
                  style={{ border: `1.5px solid ${LINE}`, background: '#fff', borderLeft: `4px solid ${agent.color}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold" style={{ color: H }}>{e.title}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: k.bg, color: k.color }}>
                        {k.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs flex items-center gap-1" style={{ color: SUB }}>
                        <Clock className="h-3 w-3" /> {formatRange(e)}
                      </span>
                      {e.location && (
                        <span className="text-xs flex items-center gap-1" style={{ color: SUB }}>
                          <MapPin className="h-3 w-3" /> {e.location}
                        </span>
                      )}
                      {e.clientName && (
                        <span className="text-xs" style={{ color: SUB }}>Client: {e.clientName}</span>
                      )}
                    </div>
                    {e.notes && <p className="text-xs mt-1.5" style={{ color: SUB }}>{e.notes}</p>}
                    {manager && e.agentName && (
                      <p className="text-[11px] mt-1.5 font-semibold" style={{ color: agent.color }}>
                        {e.agentName}
                      </p>
                    )}
                  </div>
                  {/* Every event a user can see is one they can edit: agents
                      only receive their own, managers may edit anyone's. If
                      agents are ever given read-only sight of the team's
                      calendar, this needs a permission check again. */}
                  <button
                    onClick={() => { setEditing(e); setFormOpen(true) }}
                    className="text-xs font-bold shrink-0" style={{ color: '#2E5288' }}
                  >
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <EventForm
          initial={editing}
          day={selected}
          saving={saving}
          onSave={save}
          onDelete={editing ? remove : undefined}
          onClose={() => { setFormOpen(false); setEditing(null) }}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-semibold text-white z-50"
          style={{ background: H }}>
          {toast}
        </div>
      )}
    </div>
  )
}
