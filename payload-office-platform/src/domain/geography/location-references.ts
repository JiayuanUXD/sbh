/**
 * 地理节点引用计数（tasks.md M2.2「引用数量」/ PRD L73, L133）
 *
 * 使用数量口径：当前未逻辑删除的业务对象对该区域 ID 的有效关联数，分对象类型聚合。
 * MVP 已建对象：
 *   - buildings：district / businessDistrict / nearestMetro
 *   - leads：district
 *   - users：cityScope（hasMany）
 *   - locations：parent（下级节点）
 * 商户 / 经纪人 / 团队在 M2.4 / M2.5 建立后再并入（预留 sources 扩展）。
 *
 * 依赖 payload.count（副作用），故为函数而非纯函数；单测 mock count 即可。
 */

import type { Payload, PayloadRequest, Where } from 'payload'

/** 单一来源的引用数量 */
export type ReferenceSource = {
  /** 对象类型标识（collection slug 或语义键） */
  collection: string
  /** 中文标签，供 UI 展示 */
  label: string
  /** 该来源引用数量 */
  count: number
}

export type LocationReferenceReport = {
  locationId: number | string
  /** 分来源计数 */
  sources: ReferenceSource[]
  /** 合计 */
  total: number
  /** 是否被任何对象引用（用于停用/删除保护判断） */
  referenced: boolean
}

type CountSpec = {
  collection: 'buildings' | 'city-site-profiles' | 'leads' | 'users' | 'locations'
  label: string
  where: (id: number | string) => Where
}

/**
 * 引用来源清单。新增引用型 collection 时在此登记即可，计数与报告自动纳入。
 */
const REFERENCE_SPECS: CountSpec[] = [
  {
    collection: 'buildings',
    label: '楼盘（行政区）',
    where: (id) => ({ district: { equals: id } }),
  },
  {
    collection: 'buildings',
    label: '楼盘（商圈）',
    where: (id) => ({ businessDistrict: { equals: id } }),
  },
  {
    collection: 'buildings',
    label: '楼盘（最近地铁）',
    where: (id) => ({ nearestMetro: { equals: id } }),
  },
  {
    collection: 'leads',
    label: '线索（意向区域）',
    where: (id) => ({ district: { equals: id } }),
  },
  {
    collection: 'users',
    label: '账号（城市范围）',
    where: (id) => ({ cityScope: { in: [id] } }),
  },
  {
    collection: 'locations',
    label: '下级节点',
    where: (id) => ({ parent: { equals: id } }),
  },
  {
    collection: 'city-site-profiles',
    label: '城市站点配置（城市）',
    where: (id) => ({ city: { equals: id } }),
  },
  {
    collection: 'city-site-profiles',
    label: '城市站点配置（精选区域）',
    where: (id) => ({ featuredRegions: { in: [id] } }),
  },
]

/**
 * 统计某地理节点的引用数量（分对象聚合）。
 *
 * @param req 传入以继承数据权限;默认 overrideAccess: false,统计随权限脱敏(符合 PRD L73「按当前数据权限脱敏」),用于「查看引用」展示。
 * @param options.overrideAccess 置 true 则忽略数据权限做全量统计;删除/停用保护是完整性不变量,须看到全部引用(含当前用户无权查看的对象),故传 true。
 */
export async function countLocationReferences(
  payload: Payload,
  locationId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<LocationReferenceReport> {
  const overrideAccess = options?.overrideAccess ?? false
  const results = await Promise.all(
    REFERENCE_SPECS.map(async (spec) => {
      const res = await payload.count({
        collection: spec.collection,
        where: spec.where(locationId),
        overrideAccess,
        req,
      })
      return {
        collection: spec.collection,
        label: spec.label,
        count: res.totalDocs,
      }
    }),
  )

  // 仅保留有引用的来源，UI 更清爽；total 仍为全量合计
  const sources = results.filter((s) => s.count > 0)
  const total = results.reduce((sum, s) => sum + s.count, 0)

  return {
    locationId,
    sources,
    total,
    referenced: total > 0,
  }
}
