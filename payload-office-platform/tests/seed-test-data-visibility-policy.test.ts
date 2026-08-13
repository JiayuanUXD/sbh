import { describe, expect, it } from 'vitest'

import { applySeedTestListingVisibilityPolicy } from '../scripts/seed-test-data-policy'

describe('seed-test-data listing visibility policy', () => {
  it('keeps the three empty-building fixtures out of effective public supply', () => {
    const fixtures = [
      { buildingSlug: 'empty-building', slug: 'eb-120sqm-traditional' },
      { buildingSlug: 'empty-building', slug: 'eb-380sqm-traditional' },
      { buildingSlug: 'empty-building', slug: 'eb-850sqm-fullfloor' },
    ]

    expect(fixtures.map(applySeedTestListingVisibilityPolicy)).toEqual([
      {
        buildingSlug: 'empty-building',
        slug: 'eb-120sqm-traditional',
        supplyVisibilityHold: 'pending_recheck',
      },
      {
        buildingSlug: 'empty-building',
        slug: 'eb-380sqm-traditional',
        supplyVisibilityHold: 'pending_recheck',
      },
      {
        buildingSlug: 'empty-building',
        slug: 'eb-850sqm-fullfloor',
        supplyVisibilityHold: 'pending_recheck',
      },
    ])
  })

  it('leaves an unrelated west-nanjing fixture publicly eligible', () => {
    expect(
      applySeedTestListingVisibilityPolicy({
        buildingSlug: 'west-nanjing-premium-center',
        slug: 'wn-80sqm-serviced',
      }),
    ).toEqual({
      buildingSlug: 'west-nanjing-premium-center',
      slug: 'wn-80sqm-serviced',
      supplyVisibilityHold: 'normal',
    })
  })
})
