import { createClient } from '@/lib/supabase/server'
import { Profile } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCheck, Clock, XCircle, Eye, Send } from 'lucide-react'

const statusConfig = {
  pending:   { label: 'Pending',   icon: Clock,     className: 'bg-gray-100 text-gray-600' },
  sent:      { label: 'Sent',      icon: Send,      className: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Delivered', icon: CheckCheck, className: 'bg-green-100 text-green-700' },
  read:      { label: 'Read',      icon: Eye,       className: 'bg-purple-100 text-purple-700' },
  failed:    { label: 'Failed',    icon: XCircle,   className: 'bg-red-100 text-red-600' },
}

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profileData } = await supabase.from('Profiles').select('*').eq('id', user!.id).single()
  const profile = profileData as Profile | null

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('company_id', profile!.company_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const counts = {
    sent: notifications?.filter((n) => n.status === 'sent').length ?? 0,
    delivered: notifications?.filter((n) => n.status === 'delivered').length ?? 0,
    read: notifications?.filter((n) => n.status === 'read').length ?? 0,
    failed: notifications?.filter((n) => n.status === 'failed').length ?? 0,
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">WhatsApp notification delivery log</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Object.entries(counts).map(([key, count]) => {
          const cfg = statusConfig[key as keyof typeof statusConfig]
          const Icon = cfg.icon
          return (
            <Card key={key}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${cfg.className}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900">{count}</p>
                  <p className="text-xs text-gray-500">{cfg.label}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notification Log</CardTitle>
        </CardHeader>
        <CardContent>
          {!notifications || notifications.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No notifications sent yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Client Request</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Property</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">WhatsApp</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => {
                    const cfg = statusConfig[n.status as keyof typeof statusConfig] ?? statusConfig.pending
                    const Icon = cfg.icon
                    return (
                      <tr key={n.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-3 text-gray-600">#{n.client_request_id}</td>
                        <td className="py-2.5 px-3 text-gray-600">#{n.property_id}</td>
                        <td className="py-2.5 px-3 text-gray-600 font-mono text-xs">{n.whatsapp_number ?? '—'}</td>
                        <td className="py-2.5 px-3">
                          <Badge className={`text-xs border-0 flex items-center gap-1 w-fit ${cfg.className}`}>
                            <Icon className="h-3 w-3" />{cfg.label}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-gray-400 text-xs">
                          {n.sent_at ? new Date(n.sent_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
