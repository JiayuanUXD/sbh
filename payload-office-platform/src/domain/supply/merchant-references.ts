/**
 * 商户供给关系引用计数 + 停用影响确认（tasks.md M2.4「启停影响确认」/ R2）
 *
 * 口径：某商户当前被多少有效供给关系引用,分来源聚合。
 * 现阶段唯一登记的来源是 building-merchant-relations（楼盘默认商户关系,半开
 * 区间,M3.3 建立）。listing_merchant_relations 曾在 M4.2 短暂作为独立关系型
 * collection 存在,OPT-034 已将其折叠进 listings.merchant 直写字段——不再是
 * 关系型 collection,因此也不会、不能以本文件 REFERENCE_SPECS 的登记方式纳入
 * 房源来源。
 *
 * 与 location-references 同构:依赖 payload.count（副作用),单测 mock count。
 */

import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

export type MerchantReferenceSource = {
  collection: string
  label: string
  count: number
}

export type MerchantReferenceReport = {
  merchantId: number | string
  sources: MerchantReferenceSource[]
  total: number
  referenced: boolean
}

type CountSpec = {
  // 目前只有 'building-merchant-relations' 一项。listing 的商户归属已在 OPT-034
  // 折叠进 listings.merchant 字段，不再是关系型 collection，不适用本 spec 登记法。
  collection: CollectionSlug
  label: string
  where: (id: number | string) => Where
}

/**
 * 引用来源清单。M3.3 起登记楼盘供给关系:统计该商户名下「当前仍有效」的关系
 *   —— effectiveFrom <= now 且（effectiveTo 为空 或 effectiveTo > now）。
 * 已失效/未来生效的历史关系不计入停用影响。OPT-034 起 listing 商户归属不再是
 * 关系型 collection（已折叠进 listings.merchant），不会再有对应条目。
 */
const REFERENCE_SPECS: CountSpec[] = [
  {
    collection: 'building-merchant-relations',
    label: '楼盘供给关系',
    where: (id) => {
      const now = new Date().toISOString()
      return {
        merchant: { equals: id },
        effectiveFrom: { less_than_equal: now },
        or: [{ effectiveTo: { exists: false } }, { effectiveTo: { greater_than: now } }],
      }
    },
  },
]

/**
 * 统计某商户的有效供给关系数量（分来源聚合）。
 *
 * @param options.overrideAccess 停用保护是完整性不变量,须看到全部关系,传 true;
 *                               「查看影响」展示按数据权限脱敏,传 false（默认）。
 */
export async function countMerchantReferences(
  payload: Payload,
  merchantId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<MerchantReferenceReport> {
  const overrideAccess = options?.overrideAccess ?? false
  const results = await Promise.all(
    REFERENCE_SPECS.map(async (spec) => {
      const res = await payload.count({
        collection: spec.collection,
        where: spec.where(merchantId),
        overrideAccess,
        req,
      })
      return { collection: spec.collection, label: spec.label, count: res.totalDocs }
    }),
  )
  const sources = results.filter((s) => s.count > 0)
  const total = results.reduce((sum, s) => sum + s.count, 0)
  return { merchantId, sources, total, referenced: total > 0 }
}
