import { describe, expect, it, vi } from 'vitest'

import {
  loadAdminNavigationBadges,
  type BadgeHTTPResponse,
} from '@/domain/admin-navigation/navigation-badge-request'

function createResponse(status: number, body: unknown): BadgeHTTPResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('admin navigation badge request', () => {
  it('passes the AbortSignal to fetch and parses a successful response', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () =>
      createResponse(200, {
        ok: true,
        badges: { leads: 3, notifications: 1 },
      }),
    )

    await expect(
      loadAdminNavigationBadges({
        fetcher,
        signal: controller.signal,
        url: '/api/admin-navigation',
      }),
    ).resolves.toEqual({
      status: 'success',
      badges: { leads: 3, notifications: 1 },
    })
    expect(fetcher).toHaveBeenCalledWith('/api/admin-navigation', {
      credentials: 'include',
      signal: controller.signal,
    })
  })

  it('treats AbortError as silent cancellation', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => {
      const error = new Error('request cancelled')
      error.name = 'AbortError'
      throw error
    })

    await expect(
      loadAdminNavigationBadges({
        fetcher,
        signal: controller.signal,
        url: '/api/admin-navigation',
      }),
    ).resolves.toEqual({ status: 'aborted' })
  })

  it('discards a stale response that resolves after cleanup aborts the signal', async () => {
    const controller = new AbortController()
    let resolveResponse: ((response: BadgeHTTPResponse) => void) | undefined
    const responsePromise = new Promise<BadgeHTTPResponse>((resolve) => {
      resolveResponse = resolve
    })
    const request = loadAdminNavigationBadges({
      fetcher: async () => responsePromise,
      signal: controller.signal,
      url: '/api/admin-navigation',
    })

    controller.abort()
    resolveResponse?.(
      createResponse(200, {
        ok: true,
        badges: { leads: 9 },
      }),
    )

    await expect(request).resolves.toEqual({ status: 'aborted' })
  })

  it('returns unauthorized without reporting an ordinary failure', async () => {
    const controller = new AbortController()

    await expect(
      loadAdminNavigationBadges({
        fetcher: async () => createResponse(401, null),
        signal: controller.signal,
        url: '/api/admin-navigation',
      }),
    ).resolves.toEqual({ status: 'unauthorized' })
  })
})
