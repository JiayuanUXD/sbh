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

  it('does not hold an unlisted slug merely because it belongs to empty-building', () => {
    expect(
      applySeedTestListingVisibilityPolicy({
        buildingSlug: 'empty-building',
        slug: 'eb-unlisted',
      }),
    ).toEqual({
      buildingSlug: 'empty-building',
      slug: 'eb-unlisted',
      supplyVisibilityHold: 'normal',
    })
  })

  it('does not hold a listed slug when it belongs to another building', () => {
    expect(
      applySeedTestListingVisibilityPolicy({
        buildingSlug: 'other-building',
        slug: 'eb-120sqm-traditional',
      }),
    ).toEqual({
      buildingSlug: 'other-building',
      slug: 'eb-120sqm-traditional',
      supplyVisibilityHold: 'normal',
    })
  })
})
