import type { PruneTimestampRef } from '@/lib/rate-limit-distributed'

/** 跨请求共享的 TTL 清理时间戳（模块级）。 */
export const ratePruneRef: PruneTimestampRef = { value: 0 }

/** 测试专用：重置模块级限流清理时间戳。 */
export function __resetRateStoreForTests(): void {
  ratePruneRef.value = 0
}
