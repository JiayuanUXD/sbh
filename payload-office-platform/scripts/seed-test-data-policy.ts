type SeedTestListingIdentity = {
  buildingSlug: string
  slug: string
}

const EMPTY_BUILDING_LISTING_SLUGS = new Set([
  'eb-120sqm-traditional',
  'eb-380sqm-traditional',
  'eb-850sqm-fullfloor',
])

export function applySeedTestListingVisibilityPolicy<T extends SeedTestListingIdentity>(
  listing: T,
): T & { supplyVisibilityHold: 'normal' | 'pending_recheck' } {
  const supplyVisibilityHold =
    listing.buildingSlug === 'empty-building' && EMPTY_BUILDING_LISTING_SLUGS.has(listing.slug)
      ? 'pending_recheck'
      : 'normal'

  return { ...listing, supplyVisibilityHold }
}
