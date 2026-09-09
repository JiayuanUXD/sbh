import { factValue, findFact } from '@/components/frontend/detail/fact-lookup'
import type { SpecRow } from '@/components/frontend/detail/SpecTable'
import type { ListingDetailViewModel } from '@/domain/public-catalog'
import { formatAvailableDate } from '@/lib/frontend/format'
import {
  LISTING_SPEC_FIELDS,
  LISTING_SPEC_GROUP_TITLES,
  isFieldVisible,
  type ListingSpecGroupId,
  type SpecVisibilityMap,
} from './fields'

/**
 * OPT-082：房源概况面板的**取值**层。
 *
 * 元数据（key / label / group / 默认可见）在 `fields.ts`，本文件只挂 `resolve`。
 * 两文件分开的理由见 `fields.ts` 文件头（客户端安全边界）；不会漂移是因为本文件的
 * resolver 表以 `fields.ts` 的 key 为索引，`tests/opt082-detail-spec-registry.test.ts`
 * 的「resolver 覆盖守卫」两头对着盯。
 *
 * 每条 `resolve` 都是从改造前 `ListingOverviewPanel.buildListingOverviewGroups` 的
 * 对象字面量里**原样搬过来**的表达式。那份清单逐条核过「域层没有 / DTO 没有」
 * （前者才真的省略，后者是映射缺口该补齐），理由记在 `ListingOverviewPanel.tsx`
 * 文件头，改任何一条之前先去读——尤其是「押金 / 付款方式分两行不硬拼成『押二付三』」
 * 与「comp 之外的 5 条不得删」这两处，它们都是复盘后写下的。
 */

export type ListingSpecContext = Pick<
  ListingDetailViewModel,
  'factGroups' | 'price' | 'availableFrom' | 'building'
>

export type ListingSpecGroup = Readonly<{
  id: ListingSpecGroupId
  title: string
  rows: readonly SpecRow[]
}>

/**
 * 核验时间事实的值是 ISO 串——`mapListingFactGroups` 对 `verification` 组
 * **没做展示格式化**（与「竣工时间」同型，`fact-lookup.ts` 已有
 * `formatCompletionYear` 这个先例）。直接展示会把
 * `2026-03-14T00:00:00.000Z` 甩给用户。
 *
 * 解析失败返回 null（该行不展示），**不退回原串**：一个看不懂的 ISO 串比不显示
 * 更糟，它会让用户以为页面坏了，而不是以为这条没有数据。
 */
export function formatSpecDate(value: string | null): string | null {
  if (value == null) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

type ListingResolver = (ctx: ListingSpecContext) => string | null

const fact = (ctx: ListingSpecContext, label: string) => factValue(findFact(ctx.factGroups, label))

export const LISTING_SPEC_RESOLVERS: Readonly<Record<string, ListingResolver>> = {
  area: (ctx) => fact(ctx, '建筑面积'),
  usableArea: (ctx) => fact(ctx, '套内参考面积'),
  efficiencyRate: (ctx) => fact(ctx, '得房率'),
  netCeilingHeight: (ctx) => fact(ctx, '净层高'),
  seats: (ctx) => fact(ctx, '工位数'),
  floor: (ctx) => fact(ctx, '房源楼层'),
  orientation: (ctx) => fact(ctx, '朝向'),
  divisible: (ctx) => fact(ctx, '可分割'),
  price: (ctx) => ctx.price?.text ?? null,
  // comp 用「年」，我们只有「月」精度——同一概念不同粒度，用可达的那个。
  minimumLease: (ctx) => fact(ctx, '最短租期'),
  // 「押金」「付款方式」**分两行独立呈现**，不合并硬拼成 comp 的"押二付三"：
  // depositMonths 是数字、paymentTerms 是自由文本，拼错比分两行说清楚更糟。
  deposit: (ctx) => fact(ctx, '押金月数'),
  paymentTerms: (ctx) => fact(ctx, '付款方式'),
  decoration: (ctx) => fact(ctx, '装修'),
  furniture: (ctx) => fact(ctx, '家具'),
  // 缺失时 formatAvailableDate 给的是既有的"面议"语义，不改用 null——
  // 同一字段站内其它位置早已是这个兜底文案。
  availableFrom: (ctx) => formatAvailableDate(ctx.availableFrom),
  registration: (ctx) => fact(ctx, '注册'),
  // 空调 / 网络 / 停车费取自 BuildingSummaryViewModel，与楼盘详情页「楼宇服务」
  // 读同一个来源字段，两页不会各读一份互相矛盾。
  airConditioning: (ctx) => ctx.building?.airConditioning ?? null,
  network: (ctx) => ctx.building?.network ?? null,
  // 金额优先、类别兜底（如"包含/不包含"）：同一个真实世界属性的两种既有记录
  // 方式，非另起判断。
  propertyFee: (ctx) => fact(ctx, '物业费金额') ?? fact(ctx, '物业费'),
  parkingFee: (ctx) => ctx.building?.parkingFee ?? null,
  // comp 叫「税费」但我们只有发票口径的枚举，保留既有更准确的标签。
  invoice: (ctx) => fact(ctx, '发票'),
  // 费用披露：删一条费用条款与删一条装修状态不是一个量级。
  otherFixedCosts: (ctx) => fact(ctx, '其他固定费用'),
  verifiedAt: (ctx) => formatSpecDate(fact(ctx, '信息核验时间')),
  priceVerifiedAt: (ctx) => formatSpecDate(fact(ctx, '价格核验时间')),
}

/**
 * 装配房源概况分组。
 *
 * 组序取自 `LISTING_SPEC_GROUP_TITLES` 的键序，组内行序取自 `LISTING_SPEC_FIELDS`
 * 的数组序——两者合起来即改造前那份硬编码清单的顺序，零变化守卫逐字盯着。
 *
 * `.filter((group) => group.rows.length > 0)`：**未勾选 ⇒ 不渲染**。默认配置下
 * 「信息时效」两项都是关的，于是整组不出现，改造前后的输出因此完全一致。
 * 这与「没值 ⇒ 不渲染」是两条独立规则，后者在 OPT-082 的下一步才加。
 */
export function buildListingOverviewGroupsFromRegistry(
  ctx: ListingSpecContext,
  visibility?: SpecVisibilityMap,
): readonly ListingSpecGroup[] {
  const groupIds = Object.keys(LISTING_SPEC_GROUP_TITLES) as ListingSpecGroupId[]
  return groupIds
    .map((id) => ({
      id,
      title: LISTING_SPEC_GROUP_TITLES[id],
      rows: LISTING_SPEC_FIELDS.filter(
        (field) => field.group === id && isFieldVisible(field, visibility),
      )
        .map((field) => ({
          label: field.label,
          value: LISTING_SPEC_RESOLVERS[field.key](ctx),
        }))
        // OPT-082：**没值就不显这行**。对 `SpecTable` 旧契约的刻意反转，
        // 裁定与代价见 `specs/work-items/OPT-082-detail-spec-field-visibility.md`
        // §2 / §11，守卫见 `tests/opt082-detail-spec-hiding.test.ts`。
        .filter((row) => row.value != null),
    }))
    .filter((group) => group.rows.length > 0)
}
