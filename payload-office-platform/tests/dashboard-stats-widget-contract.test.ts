import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDashboardStats,
  isDashboardStatsResponse,
} from '@/components/admin/StatsWidgetClient'

const componentDirectory = resolve(process.cwd(), 'src', 'components', 'admin')
const widgetSource = readFileSync(resolve(componentDirectory, 'StatsWidget.tsx'), 'utf8')
const clientPath = resolve(componentDirectory, 'StatsWidgetClient.tsx')
const clientSource = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : ''
const customStyles = readFileSync(
  resolve(process.cwd(), 'src', 'app', '(payload)', 'custom.scss'),
  'utf8',
)
const stats = {
  activeLeads: 4,
  availableListings: 5,
  buildings: 6,
  featuredListings: 7,
  leads: 8,
  listings: 9,
  listingsWithoutCover: 10,
  newLeads: 11,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard statistics widget contract', () => {
  it('keeps database work out of the synchronous server widget and loads stats from the client endpoint', () => {
    expect(widgetSource).not.toMatch(/export\s+default\s+async\s+function/)
    expect(widgetSource).not.toMatch(/req\.payload\.(?:count|find)\s*\(/)
    expect(widgetSource).toContain('<StatsWidgetClient />')

    expect(clientSource).toContain("fetch('/api/dashboard-stats'")
    expect(clientSource).toContain("credentials: 'same-origin'")
  })

  it('accepts only the complete successful dashboard-stat response shape', () => {
    expect(isDashboardStatsResponse({ ok: true, stats })).toBe(true)
    expect(isDashboardStatsResponse({ ok: true, stats: { ...stats, leads: '8' } })).toBe(false)
    expect(isDashboardStatsResponse({ ok: true, stats: { ...stats, leads: -1 } })).toBe(false)
    expect(isDashboardStatsResponse({ ok: true, stats: { ...stats, leads: 1.5 } })).toBe(false)
    expect(
      isDashboardStatsResponse({
        ok: true,
        stats: { ...stats, leads: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toBe(false)
    expect(isDashboardStatsResponse({ ok: false, error: '未登录' })).toBe(false)
  })

  it('respects reduced motion and keeps the retry target at least 44px tall', () => {
    expect(customStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(customStyles).toMatch(
      /\.arco-admin-dashboard__error button\s*\{[^}]*min-height:\s*44px/s,
    )
    expect(customStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation:\s*none/s,
    )
  })

  it('requests dashboard stats with same-origin credentials and rejects malformed JSON', async () => {
    const request = vi.fn(async () => Response.json({ ok: true, stats }))
    vi.stubGlobal('fetch', request)

    await expect(fetchDashboardStats(new AbortController().signal)).resolves.toEqual(stats)
    expect(request).toHaveBeenCalledWith('/api/dashboard-stats', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    })

    const malformedRequest = vi.fn(async () => Response.json({ ok: true, stats: {} }))
    vi.stubGlobal('fetch', malformedRequest)

    await expect(fetchDashboardStats(new AbortController().signal)).rejects.toThrow(
      'dashboard statistics request failed',
    )
  })
})
