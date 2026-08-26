/**
 * 批量导入前端轮询超时判定（OPT-041 最终评审 Important 7，规格 §8「已中断」态）。
 *
 * 纯函数，供 `BulkImportViewClient.tsx` 的轮询 effect 调用。抽成这里而不是内联在
 * 组件里，是为了能用 Vitest 直接单测这条判定逻辑——本仓库目前没有 React Testing
 * Library 这类组件测试基础设施，纯函数层单测是能覆盖到这条规则的最小成本方式，
 * 与仓库既有的"纯函数层 Vitest 先写测试"的测试分层约定一致。
 *
 * 背景：客户端此前是无界的 2 秒轮询——Job 崩溃/实例回收后批次会停在 running
 * （`recoverStaleSupplyImportJobs` 释放的是 job 租约、不改批次 status），UI 会永远
 * 显示进度条，DonePanel（回滚按钮所在地）不出现，恰好在最需要回滚的失败态下
 * 回滚不可达。
 */

/** 轮询超时上界：5 分钟。远大于 Task 7 正常分片耗时（20 行一片），
 * Job 崩溃/实例回收属实例级别事件，不是分片慢；又不会让运营在真崩溃时无限等下去。 */
export const SUPPLY_IMPORT_POLL_TIMEOUT_MS = 5 * 60 * 1000

/** 批次终态（completed/failed）永远不算超时——只有仍处于非终态（queued/running）时才判定。 */
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

/**
 * 判定这一次轮询是否应该转入「已中断」态。
 *
 * @param status 最新一次轮询拿到的批次 status
 * @param elapsedMs 距离本轮 running 态开始轮询已经过去多久
 * @param timeoutMs 超时阈值，默认 `SUPPLY_IMPORT_POLL_TIMEOUT_MS`
 */
export function isSupplyImportPollTimedOut(
  status: string,
  elapsedMs: number,
  timeoutMs: number = SUPPLY_IMPORT_POLL_TIMEOUT_MS,
): boolean {
  if (TERMINAL_STATUSES.has(status)) return false
  return elapsedMs >= timeoutMs
}
