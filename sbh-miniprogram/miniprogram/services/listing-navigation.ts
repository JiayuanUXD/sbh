import { parseListingQuery, serializeListingQuery } from '../domain/listing-query.js'

const LISTINGS_TAB_PATH = '/pages/listings/index'
const LISTING_DETAIL_PATH = '/pages/listing-detail/index'
const SAFE_LISTING_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type SwitchTabOptions = Readonly<{
  url: typeof LISTINGS_TAB_PATH
  success(): void
  fail(error: unknown): void
}>

export type SwitchTabTransport = (options: SwitchTabOptions) => void

export type NavigateToOptions = Readonly<{
  url: string
  success(): void
  fail(error: unknown): void
}>

export type NavigateToTransport = (options: NavigateToOptions) => void

export type ListingNavigation = Readonly<{
  open(query: string): Promise<void>
  openDetail(slug: string): Promise<void>
  openBuildings(): Promise<void>
  openBuildingDetail(slug: string): Promise<void>
  consume(): string | null
}>

type PendingNavigation = Readonly<{
  owner: symbol
  query: string
}>

function defaultSwitchTab(options: SwitchTabOptions): void {
  wx.switchTab({
    url: options.url,
    success: () => options.success(),
    fail: (error) => options.fail(error),
  })
}

function defaultNavigateTo(options: NavigateToOptions): void {
  wx.navigateTo({
    url: options.url,
    success: () => options.success(),
    fail: (error) => options.fail(error),
  })
}

export function buildListingDetailPath(slug: string): string {
  if (!SAFE_LISTING_SLUG.test(slug)) {
    throw new TypeError('房源标识无效')
  }
  return `${LISTING_DETAIL_PATH}?slug=${encodeURIComponent(slug)}`
}

export function createListingNavigation(
  switchTab: SwitchTabTransport = defaultSwitchTab,
  navigateTo: NavigateToTransport = defaultNavigateTo,
): ListingNavigation {
  let pending: PendingNavigation | null = null

  return {
    open(query) {
      const owner = Symbol('listing-navigation')
      pending = {
        owner,
        query: serializeListingQuery(parseListingQuery(query)),
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          if (pending?.owner === owner) pending = null
          reject(error)
        }

        try {
          switchTab({
            url: LISTINGS_TAB_PATH,
            success() {
              if (settled) return
              settled = true
              resolve()
            },
            fail,
          })
        } catch (error) {
          fail(error)
        }
      })
    },

    openDetail(slug) {
      let url: string
      try {
        url = buildListingDetailPath(slug)
      } catch (error) {
        return Promise.reject(error)
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
        }

        try {
          navigateTo({
            url,
            success() {
              if (settled) return
              settled = true
              resolve()
            },
            fail,
          })
        } catch (error) {
          fail(error)
        }
      })
    },

    openBuildings() {
      return new Promise<void>((resolve, reject) => {
        try {
          switchTab({
            url: '/pages/buildings/index' as any,
            success: () => resolve(),
            fail: (error) => reject(error),
          })
        } catch (error) {
          reject(error)
        }
      })
    },

    openBuildingDetail(slug: string) {
      if (!SAFE_LISTING_SLUG.test(slug)) {
        return Promise.reject(new TypeError('楼盘标识无效'))
      }
      return new Promise<void>((resolve, reject) => {
        try {
          navigateTo({
            url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}`,
            success: () => resolve(),
            fail: (error) => reject(error),
          })
        } catch (error) {
          reject(error)
        }
      })
    },

    consume() {
      const query = pending?.query ?? null
      pending = null
      return query
    },
  }
}

export const listingNavigation = createListingNavigation()
