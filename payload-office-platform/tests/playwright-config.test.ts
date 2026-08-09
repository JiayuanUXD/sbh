import { describe, expect, it } from 'vitest'
import { resolveServerReadyURL } from '../playwright.config'

describe('Playwright webServer readiness URL', () => {
  it('keeps /admin as the default readiness route', () => {
    expect(resolveServerReadyURL('http://localhost:3719', undefined)).toBe(
      'http://localhost:3719/admin',
    )
  })

  it('uses an explicit lightweight readiness URL when provided', () => {
    expect(
      resolveServerReadyURL(
        'http://localhost:3719',
        'http://localhost:3719/entrust',
      ),
    ).toBe('http://localhost:3719/entrust')
  })
})
