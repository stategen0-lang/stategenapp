'use client'

import { useEffect, useState } from 'react'
import { Agent, Property, getAgent } from '@/lib/data'
import { readCache } from '@/lib/device-cache'
import { useBackCloses } from '@/hooks/use-back-closes'
import { useSession } from '@/hooks/use-session'
import { isManager } from '@/lib/permissions'
import PropertyDetailModal from './PropertyDetailModal'

type AgentMap = Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>

interface Props {
  property: Property
  onClose: () => void
}

/**
 * A listing opened from a list of matches, on top of that list. Closing it — ✕,
 * tap outside, pull down or the phone's back button — lands on the matches, not
 * on the page behind them. Read-only: no Edit from here.
 */
export default function MatchedListingModal({ property: p, onClose }: Props) {
  const { session } = useSession()
  useBackCloses(true, onClose)

  // The real roster, so the sheet says who listed it instead of an agent code.
  const [agents, setAgents] = useState<AgentMap>(() => readCache<AgentMap>('agents') ?? {})
  useEffect(() => {
    fetch('/api/company/agents').then(r => r.ok ? r.json() : null).then(d => { if (d?.agents) setAgents(d.agents) }).catch(() => {})
  }, [])

  const a = agents[p.agentId]
  const agent: Agent = a
    ? { id: p.agentId, name: a.name, initials: a.initials, color: a.color, shortName: a.name.split(' ')[0] }
    : getAgent(p.agentId)
  const own = session?.agentCode != null && p.agentId === session.agentCode

  return (
    <PropertyDetailModal
      property={p}
      agent={agent}
      agentWhatsApp={a?.whatsapp ?? null}
      isOwnListing={own}
      canSeePrivate={isManager(session?.role) || own}
      onClose={onClose}
    />
  )
}
