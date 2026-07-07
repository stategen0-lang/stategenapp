'use client'

import { useState } from 'react'
import { Property } from '@/types/database'
import PropertyCard from './PropertyCard'
import PropertyFormDialog from './PropertyFormDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Search } from 'lucide-react'

interface Props {
  properties: Property[]
  companyId: number
  agentId: string
}

export default function PropertyGrid({ properties, companyId, agentId }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProperty, setEditingProperty] = useState<Property | null>(null)
  const [list, setList] = useState<Property[]>(properties)

  const filtered = list.filter((p) => {
    const matchesSearch =
      p.Title.toLowerCase().includes(search.toLowerCase()) ||
      (p.Location ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (p.Neighborhood ?? '').toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || p.Status === statusFilter
    return matchesSearch && matchesStatus
  })

  function handleSaved(property: Property) {
    setList((prev) => {
      const exists = prev.find((p) => p.id === property.id)
      return exists ? prev.map((p) => (p.id === property.id ? property : p)) : [property, ...prev]
    })
    setDialogOpen(false)
    setEditingProperty(null)
  }

  function handleEdit(property: Property) {
    setEditingProperty(property)
    setDialogOpen(true)
  }

  function handleDeleted(id: number) {
    setList((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by title, location, neighborhood..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditingProperty(null); setDialogOpen(true) }} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Add Property
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No properties found</p>
          <p className="text-sm mt-1">Add your first listing to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <PropertyCard key={p.id} property={p} onEdit={handleEdit} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      <PropertyFormDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingProperty(null) }}
        property={editingProperty}
        companyId={companyId}
        agentId={agentId}
        onSaved={handleSaved}
      />
    </>
  )
}
