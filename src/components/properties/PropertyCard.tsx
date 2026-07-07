'use client'

import { Property } from '@/types/database'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { BedDouble, Bath, Maximize2, MapPin, Pencil, Trash2 } from 'lucide-react'

interface Props {
  property: Property
  onEdit: (p: Property) => void
  onDeleted: (id: number) => void
}

const statusStyles: Record<string, string> = {
  available: 'bg-green-50 text-green-700',
  reserved:  'bg-yellow-50 text-yellow-700',
  sold:      'bg-gray-100 text-gray-500',
}

export default function PropertyCard({ property: p, onEdit, onDeleted }: Props) {
  const supabase = createClient()

  let photos: string[] = []
  try { photos = JSON.parse(p.Photos ?? '[]') } catch { photos = [] }

  let amenities: string[] = []
  try { amenities = JSON.parse(p.Amenities ?? '[]') } catch { amenities = [] }

  async function handleDelete() {
    if (!confirm(`Delete "${p.Title}"?`)) return
    await supabase.from('Properties').delete().eq('id', p.id)
    onDeleted(p.id)
  }

  return (
    <Card className="overflow-hidden flex flex-col">
      {/* Photo */}
      <div className="h-44 bg-gray-100 relative overflow-hidden">
        {photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photos[0]} alt={p.Title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">No photo</div>
        )}
        <Badge
          className={`absolute top-2 right-2 text-xs font-medium border-0 ${statusStyles[p.Status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}
        >
          {p.Status ?? '—'}
        </Badge>
      </div>

      <CardContent className="p-4 flex flex-col flex-1 gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 leading-tight">{p.Title}</h3>
          {p.Location && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
              <MapPin className="h-3 w-3" /> {p.Neighborhood ? `${p.Neighborhood}, ` : ''}{p.Location}
            </p>
          )}
        </div>

        <p className="text-lg font-bold text-blue-600">
          {p.Currency ?? ''} {p.Price?.toLocaleString() ?? '—'}
          {p.Payment_terms && <span className="text-xs font-normal text-gray-400 ml-1">· {p.Payment_terms}</span>}
        </p>

        <div className="flex gap-4 text-xs text-gray-500">
          {p.Bedrooms != null && <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" />{p.Bedrooms} bed</span>}
          {p.bathrooms != null && <span className="flex items-center gap-1"><Bath className="h-3.5 w-3.5" />{p.bathrooms} bath</span>}
          {p.size != null && <span className="flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5" />{p.size} m²</span>}
        </div>

        {amenities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {amenities.slice(0, 4).map((a) => (
              <span key={a} className="text-xs bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full border">{a}</span>
            ))}
            {amenities.length > 4 && (
              <span className="text-xs text-gray-400">+{amenities.length - 4} more</span>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-auto pt-2 border-t border-gray-50">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(p)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
