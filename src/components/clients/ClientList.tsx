'use client'

import { useState } from 'react'
import { ClientRequest, MatchResult } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Search, Phone, MapPin, BedDouble, Pencil, Trash2, Sparkles } from 'lucide-react'
import ClientFormDialog from './ClientFormDialog'

interface Props {
  clients: ClientRequest[]
  companyId: number
  agentId: string
}

function scoreBadge(score: number) {
  if (score >= 80) return 'bg-green-100 text-green-700 border-0'
  if (score >= 60) return 'bg-blue-100 text-blue-700 border-0'
  return 'bg-gray-100 text-gray-600 border-0'
}

export default function ClientList({ clients, companyId, agentId }: Props) {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ClientRequest | null>(null)
  const [list, setList] = useState<ClientRequest[]>(clients)
  const [matching, setMatching] = useState<number | null>(null)

  const filtered = list.filter((c) =>
    c['Client Name'].toLowerCase().includes(search.toLowerCase()) ||
    (c['client phone'] ?? '').includes(search) ||
    (c['prefered-location'] ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function handleSaved(client: ClientRequest) {
    setList((prev) => {
      const exists = prev.find((c) => c.id === client.id)
      return exists ? prev.map((c) => (c.id === client.id ? client : c)) : [client, ...prev]
    })
    setDialogOpen(false)
    setEditing(null)
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete client "${name}"?`)) return
    await supabase.from('client_requests').delete().eq('id', id)
    setList((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleRunMatch(client: ClientRequest) {
    setMatching(client.id)
    try {
      const res = await fetch('/api/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id }),
      })
      const data = await res.json()
      if (data.matches) {
        setList((prev) =>
          prev.map((c) => (c.id === client.id ? { ...c, match_results: data.matches } : c))
        )
      }
    } finally {
      setMatching(null)
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name, phone, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Add Client
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No clients found</p>
          <p className="text-sm mt-1">Add your first client to start matching</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const matches = c.match_results as MatchResult[] | null
            const topMatch = Array.isArray(matches) ? matches[0] : null
            return (
              <Card key={c.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">{c['Client Name']}</h3>
                        {c.status && (
                          <Badge variant="secondary" className="text-xs">
                            {c.status}
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        {c['client phone'] && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />{c['client phone']}
                          </span>
                        )}
                        {c['prefered-location'] && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{c['prefered-location']}
                          </span>
                        )}
                        {c.bedrooms && (
                          <span className="flex items-center gap-1">
                            <BedDouble className="h-3 w-3" />{c.bedrooms} bed
                          </span>
                        )}
                        {(c.budget_min != null || c.budget_max != null) && (
                          <span className="font-medium text-gray-600">
                            Budget: {c.budget_min?.toLocaleString() ?? '0'} – {c.budget_max?.toLocaleString() ?? '∞'}
                          </span>
                        )}
                        {c.payment_terms && <span>{c.payment_terms}</span>}
                      </div>

                      {Array.isArray(matches) && matches.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="text-xs text-gray-400">{matches.length} match{matches.length !== 1 ? 'es' : ''}:</span>
                          {matches.slice(0, 3).map((m) => (
                            <Badge key={m.property_id} className={`text-xs ${scoreBadge(m.score)}`}>
                              #{m.property_id} — {m.score}%
                            </Badge>
                          ))}
                          {matches.length > 3 && (
                            <span className="text-xs text-gray-400">+{matches.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRunMatch(c)}
                        disabled={matching === c.id}
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                        {matching === c.id ? 'Matching…' : topMatch ? 'Re-match' : 'Match'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setEditing(c); setDialogOpen(true) }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDelete(c.id, c['Client Name'])}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null) }}
        client={editing}
        companyId={companyId}
        agentId={agentId}
        onSaved={handleSaved}
      />
    </>
  )
}
