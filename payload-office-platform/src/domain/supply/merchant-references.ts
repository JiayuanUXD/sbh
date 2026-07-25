/**
 * 商户供给关系引用计数 + 停用影响确认（tasks.md M2.4「启停影响确认」/ R2）
 *
 * 口径：某商户当前被多少有效供给关系引用,分来源聚合。
 * MVP 目前尚无关系型 collection —— building_merchant_relations /
 * listing_merchant_relations 在 M3.3 建立后在 REFERENCE_SPECS 登记即自动纳入。
 * 现阶段 specs 为空,停用不受阻,但 UI 的「查看影响」入口与保护机制已就位。
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
  // M3.3 起为 'building-merchant-relations'；M3 房源关系建立后加 'listing-merchant-relations'
  collection: CollectionSlug
  label: string
  where: (id: number | string) => Where
}

/**
 * 引用来源清单。M3.3 起登记楼盘供给关系:统计该商户名下「当前仍有效」的关系
 *   —— effectiveFrom <= now 且（effectiveTo 为空 或 effectiveTo > now）。
 * 已失效/未来生效的历史关系不计入停用影响。listing-merchant-relations 待 M3
 * 房源关系建立后同法登记。
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
