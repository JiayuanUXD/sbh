import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearFavoritesForTesting,
  getFavoriteBuildings,
  getFavoriteListings,
  getFavoritesSummary,
  isBuildingFavorite,
  isListingFavorite,
  toggleBuildingFavorite,
  toggleListingFavorite,
} from '../miniprogram/services/favorites.js'

describe('收藏服务 (Favorites Service)', () => {
  beforeEach(() => {
    clearFavoritesForTesting()
  })

  it('初始状态下收藏与摘要全为 0', () => {
    const summary = getFavoritesSummary()
    expect(summary).toEqual({
      listingCount: 0,
      buildingCount: 0,
      historyCount: 0,
      compareCount: 0,
    })
    expect(getFavoriteListings()).toHaveLength(0)
    expect(getFavoriteBuildings()).toHaveLength(0)
  })

  it('收藏与取消收藏房源正常切换且幂等', () => {
    const listing = {
      slug: 'wheelock-square-12f',
      title: '越洋国际广场 · 12 层整层',
      imageUrl: 'https://example.com/img.jpg',
    }

    expect(isListingFavorite(listing.slug)).toBe(false)

    // 首次点击：收藏
    const added = toggleListingFavorite(listing)
    expect(added).toBe(true)
    expect(isListingFavorite(listing.slug)).toBe(true)
    expect(getFavoritesSummary().listingCount).toBe(1)
    expect(getFavoriteListings()[0]?.slug).toBe(listing.slug)

    // 再次点击：取消收藏
    const removed = toggleListingFavorite(listing)
    expect(removed).toBe(false)
    expect(isListingFavorite(listing.slug)).toBe(false)
    expect(getFavoritesSummary().listingCount).toBe(0)
    expect(getFavoriteListings()).toHaveLength(0)
  })

  it('收藏与取消收藏楼盘正常切换且独立于房源', () => {
    const building = {
      slug: 'wheelock-square',
      name: '越洋国际广场',
    }

    expect(isBuildingFavorite(building.slug)).toBe(false)

    const added = toggleBuildingFavorite(building)
    expect(added).toBe(true)
    expect(isBuildingFavorite(building.slug)).toBe(true)
    expect(getFavoritesSummary().buildingCount).toBe(1)
    expect(getFavoritesSummary().listingCount).toBe(0)

    const removed = toggleBuildingFavorite(building)
    expect(removed).toBe(false)
    expect(isBuildingFavorite(building.slug)).toBe(false)
    expect(getFavoritesSummary().buildingCount).toBe(0)
  })

  it('上限保护：收藏列表限制在合理数量内且防重复', () => {
    for (let i = 1; i <= 5; i++) {
      toggleListingFavorite({
        slug: `listing-${i}`,
        title: `房源 ${i}`,
      })
    }
    expect(getFavoritesSummary().listingCount).toBe(5)
  })
})
