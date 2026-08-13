import { createHash } from 'node:crypto'

import type { CityPartnerDetailsInput } from './public-service'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function computeCityPartnerIdempotencyKey(
  requestId: string,
  phoneNormalized: string,
  cityId: number | string,
): string {
  return sha256(`${requestId} | ${phoneNormalized} | ${String(cityId)}`)
}

export function computeCityPartnerDetailsFingerprint(
  details: CityPartnerDetailsInput,
): string {
  return sha256(JSON.stringify({
    organizationName: details.organizationName ?? null,
    resourceTypes: details.resourceTypes ?? null,
    otherResource: details.otherResource ?? null,
    experienceSummary: details.experienceSummary ?? null,
    cooperationPlan: details.cooperationPlan ?? null,
  }))
}
