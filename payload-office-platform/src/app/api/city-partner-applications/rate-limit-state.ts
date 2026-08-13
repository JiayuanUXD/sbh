import type { PruneTimestampRef } from '@/lib/rate-limit-distributed'

export const createRatePruneRef: PruneTimestampRef = { value: 0 }
export const detailsRatePruneRef: PruneTimestampRef = { value: 0 }

export function __resetRateStoreForTests(): void {
  createRatePruneRef.value = 0
  detailsRatePruneRef.value = 0
}
