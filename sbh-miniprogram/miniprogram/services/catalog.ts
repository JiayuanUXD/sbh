import {
  parseMiniHomeData,
  parseMiniListingDetailData,
  parseMiniListingsData,
  type MiniHomeData,
  type MiniListingDetailData,
  type MiniListingsData,
} from './catalog-contracts.js'
import { normalizeListingQuery } from '../domain/listing-query.js'
import { request, type RequestOptions } from './request.js'

export type MiniRequestClient = <T>(options: RequestOptions<T>) => Promise<T>

const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function requireSafeListingSlug(value: string): string {
  if (!SAFE_SLUG_PATTERN.test(value)) {
    throw new TypeError('房源标识无效')
  }
  return value
}

export function createCatalogService(requestClient: MiniRequestClient = request) {
  return {
    getHome(city = 'shanghai'): Promise<MiniHomeData> {
      return requestClient({
        path: `/api/mini/v1/home?city=${encodeURIComponent(city)}`,
        parse: parseMiniHomeData,
      })
    },
    getListings(query = ''): Promise<MiniListingsData> {
      const serializedQuery = normalizeListingQuery(query)
      const suffix = serializedQuery ? `&${serializedQuery}` : ''
      return requestClient({
        path: `/api/mini/v1/listings?city=shanghai${suffix}`,
        parse: parseMiniListingsData,
      })
    },
    getListingDetail(slug: string): Promise<MiniListingDetailData> {
      const safeSlug = requireSafeListingSlug(slug)
      return requestClient({
        path: `/api/mini/v1/listings/${encodeURIComponent(safeSlug)}?city=shanghai`,
        parse: (value) => parseMiniListingDetailData(value, safeSlug),
      })
    },
  }
}

export const catalog = createCatalogService()
export const getHome = catalog.getHome
export const getListings = catalog.getListings
export const getListingDetail = catalog.getListingDetail
