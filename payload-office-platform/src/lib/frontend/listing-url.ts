import type { PriceDisplayUnit } from '@/domain/public-catalog'

/**
 * 列表页 href 构造基元。
 *
 * 收敛理由（OPT-036 Task 7 code review）：`PriceUnitSegment.tsx` 与
 * `ExcludedUnitsBar.tsx` 曾各自内联一份逐字节相同的「克隆 currentParams →
 * 改一个参数 → 拼 basePath」函数。两个组件同目录却各自持有同一份 URL 变更
 * 契约，下一次改动（比如再加一个要清理的旧参数）大概率只改一处、漏改另一处
 * ——这正是本仓库「查询/筛选/格式化逻辑集中在 lib/frontend」既定约定
 * （见 `listing-display.ts` 顶部同类收敛理由）要防的漂移，因此提到这里。
 *
 * 与 `FilterFormC.tsx` 的 `cloneParams` / `toHref` / `buildOptionHref` 是
 * 什么关系：
 *   - `cloneSearchParams` / `buildHref`（本文件）与 FilterFormC 私有的
 *     `cloneParams` / `toHref` 是**同一个原语**（逐行相同实现），因此收敛到
 *     这里，FilterFormC 改为从这里导入，不再自己重复定义。
 *   - `buildPriceUnitHref`（本文件）与 FilterFormC 的 `buildOptionHref` **语义
 *     不同**，刻意不合并：`buildOptionHref` 服务的是「同一行内多个互斥选项，
 *     再点已选项即清除本行」——`isActive` 时只删不设，允许「不选」是合法状态。
 *     `priceUnit` 没有「不选」这个合法状态：结果集必须始终处在某一个单位下
 *     （见 `PriceUnitSegment.tsx` 顶部注释），因此 `buildPriceUnitHref` 永远
 *     `set`，没有 toggle-off 分支。把两者塞进同一个函数签名，只会逼着调用方
 *     传一个「其实不能为 true」的 `isActive`，属于伪造出来的通用性。
 */

/** 克隆 currentParams：统一入口，避免各处直接 new 出来时忘记带上已有参数。 */
export function cloneSearchParams(currentParams: URLSearchParams): URLSearchParams {
  return new URLSearchParams(currentParams)
}

/** 拼出最终 href：无查询串时省略问号。 */
export function buildHref(basePath: string, sp: URLSearchParams): string {
  const qs = sp.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

/**
 * 租金单位切换 href：`PriceUnitSegment` 与 `ExcludedUnitsBar` 共用同一份契约。
 *
 *   - 写入 `priceUnit`，永远 `set`（见上方与 buildOptionHref 的区分说明）；
 *   - 删除 `page`：换单位即换结果集（`findEffectiveListings` 对 `priceUnit`
 *     做的是 `where.rentUnit = { equals }` 精确过滤，不是同结果集内重排），
 *     停在旧页码会看到空结果或跳过前面的房源；
 *   - 删除残留的旧名 `rentUnit`：域层解析仍接受 `rentUnit` 兜底（`priceUnit`
 *     优先），但 `buildCanonicalSearchParams` 只输出 `priceUnit`——本函数构造
 *     新 href 时一并清掉，不让非 canonical 参数组合流回地址栏。
 *   - 排序参数（如 `sort=price-asc`）不需要特殊处理：`normalizeSort` 只在
 *     `priceUnit` 缺失时把价格排序降级为 `recommended`（见
 *     `domain/public-catalog/search-params.ts`）；本函数永远 `set` 一个
 *     `priceUnit` 值，从不清空它，降级分支不会被触发。
 */
export function buildPriceUnitHref(
  basePath: string,
  currentParams: URLSearchParams,
  unit: PriceDisplayUnit,
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  sp.delete('rentUnit')
  sp.set('priceUnit', unit)
  return buildHref(basePath, sp)
}
