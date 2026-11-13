import {
  parseMiniArticleDetailData,
  parseMiniArticlesData,
  parseMiniBuildingCard,
  parseMiniBuildingDetailData,
  parseMiniBuildingsData,
  parseMiniHomeData,
  parseMiniListingDetailData,
  parseMiniListingsData,
  type MiniArticleDetailData,
  type MiniArticlesData,
  type MiniArticlesQuery,
  type MiniBuildingCard,
  type MiniBuildingDetailData,
  type MiniBuildingsData,
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

function requireSafeBuildingSlug(value: string): string {
  if (!SAFE_SLUG_PATTERN.test(value)) {
    throw new TypeError('楼盘标识无效')
  }
  return value
}

function requireSafeArticleSlug(value: string): string {
  if (!SAFE_SLUG_PATTERN.test(value)) {
    throw new TypeError('文章标识无效')
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
    getBuildings(query = ''): Promise<MiniBuildingsData> {
      const suffix = query ? `&${query.replace(/^\?/, '')}` : ''
      return requestClient({
        path: `/api/mini/v1/buildings?city=shanghai${suffix}`,
        parse: parseMiniBuildingsData,
      })
    },
    getBuildingDetail(slug: string): Promise<MiniBuildingDetailData> {
      const safeSlug = requireSafeBuildingSlug(slug)
      return requestClient({
        path: `/api/mini/v1/buildings/${encodeURIComponent(safeSlug)}?city=shanghai`,
        parse: (value) => parseMiniBuildingDetailData(value, safeSlug),
      })
    },
    getArticles(query?: MiniArticlesQuery): Promise<MiniArticlesData> {
      const parts: string[] = []
      if (query?.page !== undefined) parts.push(`page=${encodeURIComponent(query.page)}`)
      if (query?.pageSize !== undefined) parts.push(`pageSize=${encodeURIComponent(query.pageSize)}`)
      if (query?.category) parts.push(`category=${encodeURIComponent(query.category)}`)
      const suffix = parts.length > 0 ? `?${parts.join('&')}` : ''
      return requestClient({
        path: `/api/mini/v1/articles${suffix}`,
        parse: parseMiniArticlesData,
      })
    },
    getArticleDetail(slug: string): Promise<MiniArticleDetailData> {
      const safeSlug = requireSafeArticleSlug(slug)
      return requestClient({
        path: `/api/mini/v1/articles/${encodeURIComponent(safeSlug)}`,
        parse: (value) => parseMiniArticleDetailData(value, safeSlug),
      })
    },
  }
}

export const catalog = createCatalogService()
export const getHome = catalog.getHome
export const getListings = catalog.getListings
export const getListingDetail = catalog.getListingDetail
export const getBuildings = catalog.getBuildings
export const getBuildingDetail = catalog.getBuildingDetail
export const getArticles = catalog.getArticles
export const getArticleDetail = catalog.getArticleDetail
