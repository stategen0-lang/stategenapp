// Manager / agent permission rules — pure and deterministic so they can be
// unit-tested and reused identically on the server (enforcement) and in the
// UI (what to render).
//
//   manager (role 'owner' | 'manager')
//     • sees every client, deal and property, with full contact details
//     • can filter the board/lists down to a single agent
//     • can edit anything
//
//   agent (role 'agent')
//     • sees all company properties, but edits only the ones they listed
//     • sees only their own deals in the pipeline
//     • other agents' clients are visible but name + phone are masked,
//       and they cannot be edited

export type Role = 'owner' | 'manager' | 'agent'

export interface Session {
  userId: string
  companyId: number
  role: Role
  agentCode: string | null   // 'a1'..'a4' — null for managers
  fullName: string
}

export function isManager(role: Role | string | null | undefined): boolean {
  return role === 'owner' || role === 'manager'
}

// Does this session own the record tagged with `ownerAgentCode`?
export function owns(session: Session, ownerAgentCode: string | null | undefined): boolean {
  if (!session.agentCode) return false
  return session.agentCode === ownerAgentCode
}

// Full contact details (name, phone) — managers always; agents only their own.
export function canSeeClientPII(session: Session, clientAgentCode: string | null | undefined): boolean {
  return isManager(session.role) || owns(session, clientAgentCode)
}

// Editing a client (details, status, rating) follows the same ownership rule.
export function canEditClient(session: Session, clientAgentCode: string | null | undefined): boolean {
  return isManager(session.role) || owns(session, clientAgentCode)
}

// Properties: everyone in the company can read; only the lister (or a manager)
// can edit.
export function canEditProperty(session: Session, propertyAgentCode: string | null | undefined): boolean {
  return isManager(session.role) || owns(session, propertyAgentCode)
}

// Pipeline: managers see every deal (optionally filtered to one agent),
// agents only ever see their own.
export function canSeeDeal(session: Session, dealAgentCode: string | null | undefined, agentFilter?: string | null): boolean {
  if (isManager(session.role)) {
    return !agentFilter || dealAgentCode === agentFilter
  }
  return owns(session, dealAgentCode)
}

// Replace the identifying fields an agent isn't allowed to see. The record is
// still returned so demand is visible for matching — just not who it is.
export function maskClientName(clientId: number): string {
  return `Client #${clientId}`
}

export interface MaskableClient {
  id: number
  name: string
  phone: string
  email?: string
  [key: string]: unknown
}

export function maskClient<T extends MaskableClient>(client: T): T {
  return { ...client, name: maskClientName(client.id), phone: '', email: '', masked: true }
}
