import type { SanitizedPermissions } from 'payload'

import { canReadCollection } from './collection-read-access'

type DocumentID = number | string
export type ContextCollection = 'lead-ownership-history' | 'form-submissions'

function isDocumentID(value: unknown): value is DocumentID {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > 0)
  )
}

function buildContextURL(
  collection: ContextCollection,
  relation: 'lead' | 'form',
  id: unknown,
): string | null {
  if (!isDocumentID(id)) return null

  const searchParams = new URLSearchParams({
    [`where[${relation}][equals]`]: String(id),
  })

  return `/admin/collections/${collection}?${searchParams.toString()}`
}

export function buildLeadOwnershipHistoryURL(id: unknown): string | null {
  return buildContextURL('lead-ownership-history', 'lead', id)
}

export function buildFormSubmissionsURL(id: unknown): string | null {
  return buildContextURL('form-submissions', 'form', id)
}

export function canReadContextCollection(
  permissions: SanitizedPermissions | undefined,
  collection: ContextCollection,
): boolean {
  return canReadCollection(permissions, collection)
}
