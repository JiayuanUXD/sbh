import type { PruneTimestampRef } from '@/lib/rate-limit-distributed'

/** 跨请求共享的保留期清理时间戳（模块级，每个实例各一份）。 */
export const searchMissPruneRef: PruneTimestampRef = { value: 0 }

/** 测试专用：重置清理时间戳。 */
export function __resetSearchMissPruneForTests(): void {
  searchMissPruneRef.value = 0
}
