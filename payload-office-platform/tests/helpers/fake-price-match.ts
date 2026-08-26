/**
 * 假适配器共用的价格判据（单位 + 区间）。
 *
 * 三份假 SupplyAdapter（`public-catalog-facade` / `f7-6-production-equivalence-acceptance`
 * / `public-catalog-effective-supply-consistency`）曾各自内联一份逐字节相同的实现。
 * 三份拷贝的代价在这次改动上兑现了：生产实现从「判旧列 rentUnit」改成「判
 * `resolveListingPrice` 归一后的 displayUnit」，三处都得跟着改，漏改任何一处都
 * **不会报错**——只会让那个文件里的「所有消费者结论一致」变成拿一个不存在的口径
 * 自证。收敛成一处后，下次改生产实现只需要对齐这一个文件。
 *
 * 这里刻意**手写重述**生产逻辑，而不是 import `supply-adapter` 的内部函数：假适配器
 * 的作用就是给出一份独立的口径表述，直接复用生产代码会让断言退化成恒等式。唯一
 * 复用的是 `resolveListingPrice`——它是「结构化价格 ?? 旧列」这条归一规则本身，
 * 不是被验证的筛选逻辑，重述它只会引入第二份归一规则（正是本次缺陷的根因）。
 *
 * 口径（与 `supply-adapter.ts#filterByPrice` 一致）：
 *   - 缺 `priceUnit` 时整段不生效——跨计价单位比 amount 无意义
 *     （元/月 vs 元/㎡/天 vs 元/工位/月），假适配器不能比生产实现宽松；
 *   - 单位不等于 `priceUnit` 的不入选，即使金额落在区间内；
 *   - 「面议」房源：选单位时留、给区间时剔。
 */
import type { Listing } from '@/payload-types'
import { resolveListingPrice } from '@/domain/public-catalog/mappers'

export function matchesPriceInput(
  listing: Listing,
  input: Readonly<{ priceUnit?: string; priceMin?: number; priceMax?: number }>,
): boolean {
  const { priceUnit, priceMin, priceMax } = input
  if (!priceUnit) return true
  const price = resolveListingPrice(listing)
  if (!price) return priceMin == null && priceMax == null
  if (price.displayUnit !== priceUnit) return false
  if (priceMin != null && price.amount < priceMin) return false
  if (priceMax != null && price.amount > priceMax) return false
  return true
}
