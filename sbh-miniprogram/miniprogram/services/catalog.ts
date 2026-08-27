import {
  parseMiniHomeData,
  parseMiniListingsData,
  type MiniHomeData,
  type MiniListingsData,
} from './catalog-contracts.js'
import { normalizeListingQuery } from '../domain/listing-query.js'
import { request, type RequestOptions } from './request.js'

export type MiniRequestClient = <T>(options: RequestOptions<T>) => Promise<T>

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
  }
}

export const catalog = createCatalogService()
export const getHome = catalog.getHome
export const getListings = catalog.getListings
