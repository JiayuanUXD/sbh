import { describe, expect, it } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'
import {
  buildReviewCityScopeWhere,
  canReadListingReviews,
} from '@/domain/review/listing-review-access'

function context(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: 1,
    roleCodes: ['OPS'],
    cityIds: new Set([10]),
    teamIds: new Set(),
    operationPermissions: new Set(['listing:review']),
    fieldPermissions: new Set(),
    menuPermissions: new Set(['listing-reviews']),
    dataScope: 'city',
    ...overrides,
  }
}

describe('canReadListingReviews', () => {
  it('requires both menu and review operation permissions', () => {
    expect(canReadListingReviews(context())).toBe(true)
    expect(canReadListingReviews(context({ menuPermissions: new Set() }))).toBe(false)
    expect(
      canReadListingReviews(context({ operationPermissions: new Set() })),
    ).toBe(false)
  })

  it('fails closed for team, self and none data scopes', () => {
    expect(canReadListingReviews(context({ dataScope: 'team' }))).toBe(false)
    expect(canReadListingReviews(context({ dataScope: 'self' }))).toBe(false)
    expect(canReadListingReviews(context({ dataScope: 'none' }))).toBe(false)
  })

  it('accepts wildcard administrator permissions', () => {
    expect(
      canReadListingReviews(
        context({
          roleCodes: ['ADM'],
          operationPermissions: new Set(['*']),
          menuPermissions: new Set(['*']),
          dataScope: 'global',
        }),
      ),
    ).toBe(true)
  })
})

describe('buildReviewCityScopeWhere', () => {
  it('returns no additional constraint for an unrestricted account', () => {
    expect(
      buildReviewCityScopeWhere(context({ cityIds: 'all' }), 'listing.building.city'),
    ).toBeNull()
  })

  it('builds a constraint from the server permission context', () => {
    expect(
      buildReviewCityScopeWhere(
        context({ cityIds: new Set([10, 20]) }),
        'listing.building.city',
      ),
    ).toEqual({ 'listing.building.city': { in: [10, 20] } })
  })

  it('matches no documents when the account city set is empty', () => {
    expect(
      buildReviewCityScopeWhere(
        context({ cityIds: new Set() }),
        'listing.building.city',
      ),
    ).toEqual({ id: { exists: false } })
  })
})
