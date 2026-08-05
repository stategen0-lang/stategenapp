// Manual-billing helpers (client-safe: no secrets, no server imports).
//
// Companies pay offline; the platform admin activates them and sets a paid-through
// date. Access is granted only while the company is 'active' and within that date.

export type AccessStatus = 'pending' | 'active' | 'expired' | 'suspended'

/** Does a company currently have access to the app? */
export function companyHasAccess(
  status: string | null | undefined,
  until: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (status !== 'active') return false
  if (!until) return true                 // active with no end date = open-ended
  return new Date(until).getTime() > now.getTime()
}

/** A short, human explanation for the /renew screen. */
export function accessMessage(status: string | null | undefined): string {
  switch (status) {
    case 'pending':   return 'Your account is set up and waiting to be activated. Contact StateGen to get started.'
    case 'expired':   return 'Your subscription period has ended. Renew to restore access.'
    case 'suspended': return 'Your account has been suspended. Please contact StateGen.'
    default:          return 'Your account is not active. Please contact StateGen.'
  }
}

/** Default billing period length when activating/renewing (one month). */
export const DEFAULT_PERIOD_DAYS = 30
