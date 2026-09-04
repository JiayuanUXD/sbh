export interface FavoriteListingItem {
  id: string
  slug: string
  title: string
  imageUrl?: string
  addedAt: number
}

export interface FavoriteBuildingItem {
  id: string
  slug: string
  name: string
  addedAt: number
}

export interface FavoritesSummary {
  listingCount: number
  buildingCount: number
  historyCount: number
  compareCount: number
}

const STORAGE_KEY_LISTINGS = 'sbh_fav_listings_v1'
const STORAGE_KEY_BUILDINGS = 'sbh_fav_buildings_v1'
const STORAGE_KEY_HISTORY = 'sbh_history_count_v1'
const STORAGE_KEY_COMPARE = 'sbh_compare_count_v1'

const MAX_FAVORITES = 100

// 内存后备存储（兼顾 Node.js 离线测试环境）
let memListings: FavoriteListingItem[] = []
let memBuildings: FavoriteBuildingItem[] = []

function hasWxStorage(): boolean {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function'
}

function loadListings(): FavoriteListingItem[] {
  if (hasWxStorage()) {
    try {
      const data = wx.getStorageSync(STORAGE_KEY_LISTINGS)
      if (Array.isArray(data)) return data
    } catch {
      // ignore
    }
  }
  return memListings
}

function saveListings(items: FavoriteListingItem[]): void {
  const capped = items.slice(0, MAX_FAVORITES)
  memListings = capped
  if (hasWxStorage()) {
    try {
      wx.setStorageSync(STORAGE_KEY_LISTINGS, capped)
    } catch {
      // ignore
    }
  }
}

function loadBuildings(): FavoriteBuildingItem[] {
  if (hasWxStorage()) {
    try {
      const data = wx.getStorageSync(STORAGE_KEY_BUILDINGS)
      if (Array.isArray(data)) return data
    } catch {
      // ignore
    }
  }
  return memBuildings
}

function saveBuildings(items: FavoriteBuildingItem[]): void {
  const capped = items.slice(0, MAX_FAVORITES)
  memBuildings = capped
  if (hasWxStorage()) {
    try {
      wx.setStorageSync(STORAGE_KEY_BUILDINGS, capped)
    } catch {
      // ignore
    }
  }
}

export function isListingFavorite(slug: string): boolean {
  if (!slug) return false
  const list = loadListings()
  return list.some((item) => item.slug === slug)
}

export function toggleListingFavorite(listing: {
  slug: string
  title: string
  imageUrl?: string
}): boolean {
  if (!listing || !listing.slug) return false
  const list = loadListings()
  const existsIndex = list.findIndex((item) => item.slug === listing.slug)

  if (existsIndex >= 0) {
    list.splice(existsIndex, 1)
    saveListings(list)
    return false
  }

  list.unshift({
    id: `fav_l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    slug: listing.slug,
    title: listing.title,
    imageUrl: listing.imageUrl,
    addedAt: Date.now(),
  })
  saveListings(list)
  return true
}

export function isBuildingFavorite(slug: string): boolean {
  if (!slug) return false
  const list = loadBuildings()
  return list.some((item) => item.slug === slug)
}

export function toggleBuildingFavorite(building: {
  slug: string
  name: string
}): boolean {
  if (!building || !building.slug) return false
  const list = loadBuildings()
  const existsIndex = list.findIndex((item) => item.slug === building.slug)

  if (existsIndex >= 0) {
    list.splice(existsIndex, 1)
    saveBuildings(list)
    return false
  }

  list.unshift({
    id: `fav_b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    slug: building.slug,
    name: building.name,
    addedAt: Date.now(),
  })
  saveBuildings(list)
  return true
}

export function getFavoriteListings(): FavoriteListingItem[] {
  return loadListings()
}

export function getFavoriteBuildings(): FavoriteBuildingItem[] {
  return loadBuildings()
}

export function getFavoritesSummary(): FavoritesSummary {
  const listings = loadListings()
  const buildings = loadBuildings()

  let historyCount = 0
  let compareCount = 0

  if (hasWxStorage()) {
    try {
      historyCount = Number(wx.getStorageSync(STORAGE_KEY_HISTORY)) || 0
      compareCount = Number(wx.getStorageSync(STORAGE_KEY_COMPARE)) || 0
    } catch {
      // ignore
    }
  }

  return {
    listingCount: listings.length,
    buildingCount: buildings.length,
    historyCount,
    compareCount,
  }
}

export function clearFavoritesForTesting(): void {
  memListings = []
  memBuildings = []
  if (hasWxStorage()) {
    try {
      wx.removeStorageSync(STORAGE_KEY_LISTINGS)
      wx.removeStorageSync(STORAGE_KEY_BUILDINGS)
      wx.removeStorageSync(STORAGE_KEY_HISTORY)
      wx.removeStorageSync(STORAGE_KEY_COMPARE)
    } catch {
      // ignore
    }
  }
}
