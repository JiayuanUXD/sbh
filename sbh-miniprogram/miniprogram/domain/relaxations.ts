import {
  applyListingPatch,
  serializeListingQuery,
  type ListingQuery,
} from './listing-query.js'
import type { MiniListingsData } from '../services/catalog-contracts.js'

export type RelaxationDimension = 'q' | 'district' | 'area' | 'price' | 'availableBefore'

export type RelaxationCandidate = Readonly<{
  dimension: RelaxationDimension
  label: string
  query: string
}>

export type RelaxationSuggestion = RelaxationCandidate & Readonly<{
  count: number
}>

function candidate(
  query: ListingQuery,
  dimension: RelaxationDimension,
  label: string,
  patch: Parameters<typeof applyListingPatch>[1],
): RelaxationCandidate {
  return {
    dimension,
    label,
    query: serializeListingQuery(applyListingPatch(query, patch)),
  }
}

/**
 * 每条候选只移除一个已收窄维度，计价单位始终保留为当前结果集的边界。
 */
export function buildRelaxationQueries(query: ListingQuery): readonly RelaxationCandidate[] {
  const candidates: RelaxationCandidate[] = []

  if (query.q) {
    candidates.push(candidate(query, 'q', '移除关键词条件', { q: undefined }))
  }
  if (query.district && query.district.length > 0) {
    candidates.push(candidate(query, 'district', '不限制区域', { district: undefined }))
  }
  if (query.areaMin !== undefined || query.areaMax !== undefined) {
    candidates.push(candidate(query, 'area', '不限制面积', {
      areaMin: undefined,
      areaMax: undefined,
    }))
  }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    candidates.push(candidate(query, 'price', '不限制价格', {
      priceMin: undefined,
      priceMax: undefined,
    }))
  }
  if (query.availableBefore) {
    candidates.push(candidate(query, 'availableBefore', '不限制最晚入驻时间', {
      availableBefore: undefined,
    }))
  }

  return candidates
}

/**
 * 最多为三条放宽候选取真实命中数。每项独立失败，不影响列表主空态或其余候选。
 */
export async function loadRelaxations(
  query: ListingQuery,
  getListings: (query: string) => Promise<MiniListingsData>,
): Promise<readonly RelaxationSuggestion[]> {
  const candidates = buildRelaxationQueries(query).slice(0, 3)
  const settled = await Promise.allSettled(
    candidates.map(async (item) => ({
      ...item,
      count: (await getListings(item.query)).pagination.totalDocs,
    })),
  )

  return settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value.count > 0 ? [result.value] : [],
  )
}
