import type { FactGroupViewModel, FactValue } from '@/domain/public-catalog'

/**
 * 详情页规格类面板共用的「按标签精确查找事实」查询——房源概况面板
 * （ListingOverviewPanel）与楼盘参数面板（BuildingSpecPanel）都需要「给一个
 * 标签，跨组找到对应的 FactValue」，收敛成一处，不各写一份（本项目此类
 * 判断逻辑重复已栽 7 次，见 cross-batch-design-decisions.md）。
 *
 * 与 `building-detail/HeroSummaryPanel.tsx` 的 `pickHeroFacts` 不是同一职责，
 * 不合并：那里是"给一份候选标签清单，按顺序挑最多 N 个能命中的"（子串匹配
 * `label.includes(wanted)`，允许标签近似），这里是"给一个已知的确切标签，
 * 取它的值"（精确匹配）。API 形状相似（都在 `factGroups` 里找东西）不等于
 * 判断逻辑相同——前者服务"排出一份优先级列表"，后者服务"取一个已知字段"。
 */
export function findFact(
  groups: readonly FactGroupViewModel[],
  label: string,
): FactValue | undefined {
  for (const group of groups) {
    const found = group.facts.find((item) => item.label === label)
    if (found) return found
  }
  return undefined
}

/**
 * `FactValue` → 展示字符串：`estimated` 时附加既有"（估算）"后缀
 * （与 `DetailFacts.tsx` 的 `detail-facts__estimated` 同一约定，只是这里把它
 * 折进字符串而非单独一个 span——`SpecTable.value` 是不透明字符串，两种呈现
 * 方式表达的是同一件事，不算另起一套判断）。
 */
export function factValue(fact: FactValue | undefined): string | null {
  if (!fact || fact.value == null) return null
  return fact.estimated ? `${fact.value}（估算）` : fact.value
}

/**
 * 「竣工时间」事实的值是 ISO 日期字符串（`mapBuildingFactGroups` 直接
 * `fact('竣工时间', building.completionDate)`，未做展示格式化）——楼盘参数
 * 面板的「竣工年份」行与信息面板挑选出的「竣工时间」关键参数都要把它转成
 * "2013 年" 这样的年份，两处是同一个转换，收敛成一处，不各写一份
 * （顺手修复：这条转换缺失前，两处都会把原始 ISO 字符串直接展示给用户）。
 */
export function formatCompletionYear(value: string, estimated = false): string | null {
  const year = new Date(value).getFullYear()
  if (!Number.isFinite(year)) return null
  return estimated ? `${year} 年（估算）` : `${year} 年`
}

/**
 * 「从 factGroups 里取出格式化好的竣工年份」——`findFact('竣工时间')` +
 * `formatCompletionYear` 的固定组合。原先只活在 `BuildingSpecPanel` 内部，
 * Task 10 接线时楼盘标题栏副标（地址 · 等级 · 竣工年）成为第二个消费方，
 * 按「同一判断逻辑不得存在多处」就地收敛，不在页面层再拼一遍这三行。
 */
export function completionYearFromGroups(
  groups: readonly FactGroupViewModel[],
): string | null {
  const fact = findFact(groups, '竣工时间')
  if (!fact || fact.value == null) return null
  return formatCompletionYear(fact.value, fact.estimated)
}
