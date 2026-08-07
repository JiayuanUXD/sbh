import type { BasePayload, PayloadRequest, Where } from 'payload'

import type {
  PausedReportLike,
  PayloadQueryPort,
} from '@/domain/review/effective-supply'

const EFFECTIVE_SUPPLY_COLLECTIONS = [
  'listing-reports',
  'listing-merchant-relations',
] as const

type EffectiveSupplyCollection = (typeof EFFECTIVE_SUPPLY_COLLECTIONS)[number]
type PayloadQueryDocument = Record<string, unknown> & PausedReportLike

function isEffectiveSupplyCollection(collection: string): collection is EffectiveSupplyCollection {
  return EFFECTIVE_SUPPLY_COLLECTIONS.some((candidate) => candidate === collection)
}

function toEffectiveSupplyCollection(collection: string): EffectiveSupplyCollection {
  if (isEffectiveSupplyCollection(collection)) return collection
  throw new Error(`effective-supply does not support collection: ${collection}`)
}

function toPayloadWhere(where: Record<string, unknown>): Where {
  if (typeof where !== 'object' || where === null || Array.isArray(where)) {
    throw new TypeError('effective-supply query must be a where object')
  }
  return where as Where
}

function isPayloadRequest(value: unknown): value is PayloadRequest {
  return typeof value === 'object' && value !== null && 'payload' in value
}

function requestOption(req: unknown): { req?: PayloadRequest } {
  if (req === undefined) return {}
  if (!isPayloadRequest(req)) {
    throw new TypeError('effective-supply requires a Payload request context')
  }
  return { req }
}

function isRelationReference(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' || typeof value === 'number') return true
  return (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'id' in value &&
    (typeof value.id === 'string' || typeof value.id === 'number')
  )
}

function isPayloadQueryDocument(value: unknown): value is PayloadQueryDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return !('targetListing' in value) || isRelationReference(value.targetListing)
}

function queryDocuments(docs: unknown): PayloadQueryDocument[] {
  if (!Array.isArray(docs)) {
    throw new TypeError('effective-supply query returned invalid documents')
  }
  if (!docs.every(isPayloadQueryDocument)) {
    throw new TypeError('effective-supply query returned an invalid document')
  }
  return docs
}

/**
 * Bounded bridge from Payload's collection-generic Local API to the effective
 * supply domain query port. Only the two collections used by the shared
 * predicate are accepted, and external document/request shapes are validated.
 */
export function createEffectiveSupplyPayloadPort(
  payload: Pick<BasePayload, 'find'>,
): PayloadQueryPort {
  return {
    async find({ collection, where, depth, limit, page, sort, overrideAccess, req }) {
      const result = await payload.find({
        collection: toEffectiveSupplyCollection(collection),
        where: toPayloadWhere(where),
        depth,
        limit,
        page,
        sort,
        overrideAccess,
        ...requestOption(req),
      })
      return {
        docs: queryDocuments(result.docs),
        hasNextPage: result.hasNextPage,
        nextPage: result.nextPage,
        page: result.page,
        totalPages: result.totalPages,
      }
    },
  }
}
