import type { AdminNavigationBadgeKey } from './navigation-types'

export type AdminNavigationBadgeCounts = Partial<
  Record<AdminNavigationBadgeKey, number>
>

export type BadgeHTTPResponse = {
  json: () => Promise<unknown>
  ok: boolean
  status: number
}

type BadgeFetcher = (
  url: string,
  init: {
    credentials: 'include'
    signal: AbortSignal
  },
) => Promise<BadgeHTTPResponse>

type BadgeRequestResult =
  | { badges: AdminNavigationBadgeCounts; status: 'success' }
  | { status: 'unauthorized' }
  | { status: 'aborted' }
  | { status: 'error' }

const BADGE_KEYS = [
  'tasks',
  'notifications',
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
  'cityPartnerApplications',
] as const satisfies readonly AdminNavigationBadgeKey[]

export async function loadAdminNavigationBadges({
  fetcher = fetch,
  signal,
  url,
}: {
  fetcher?: BadgeFetcher
  signal: AbortSignal
  url: string
}): Promise<BadgeRequestResult> {
  try {
    const response = await fetcher(url, {
      credentials: 'include',
      signal,
    })

    if (signal.aborted) return { status: 'aborted' }
    if (response.status === 401) return { status: 'unauthorized' }
    if (!response.ok) return { status: 'error' }

    const data = await response.json()
    if (signal.aborted) return { status: 'aborted' }

    const badges = parseBadgeCounts(data)
    return badges
      ? { badges, status: 'success' }
      : { status: 'error' }
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      return { status: 'aborted' }
    }
    return { status: 'error' }
  }
}

function parseBadgeCounts(value: unknown): AdminNavigationBadgeCounts | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.badges)) {
    return null
  }

  const badges: AdminNavigationBadgeCounts = {}
  for (const key of BADGE_KEYS) {
    const count = value.badges[key]
    if (count === undefined) continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      return null
    }
    badges[key] = count
  }

  return badges
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
