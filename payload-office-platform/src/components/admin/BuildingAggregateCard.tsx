import type { DocumentViewServerProps } from 'payload'

import { computeBuildingSupplyAggregate } from '@/domain/supply/building-aggregate'
import BuildingAggregateCardClient from './BuildingAggregateCardClient'

/**
 * 楼盘有效房源聚合卡片 - 服务端（tasks.md M3.4「展示有效房源套数、面积和租金聚合」/ R3）
 *
 * 落点：楼盘编辑视图 `beforeDocumentControls`。R3 末条要求「预览楼盘时展示符合
 * 统一有效供给谓词的房源聚合」，编辑视图是正确落点（原生列表无法逐行跑异步聚合）。
 *
 * 口径：computeBuildingSupplyAggregate 的 M3 过渡谓词
 *   status='available' + building.operationalStatus='active' + deletedAt exists:false。
 * 聚合按当前用户数据权限脱敏（overrideAccess 默认 false，透传 req）。
 *
 * 新建（未保存）楼盘无 id → 无可聚合对象 → 不渲染卡片。
 */
export default async function BuildingAggregateCard({
  doc,
  payload,
  initPageResult,
}: DocumentViewServerProps) {
  const building = doc as unknown as { id?: number | string }
  const buildingId = building?.id
  if (buildingId === undefined || buildingId === null || buildingId === '') return null

  const aggregate = await computeBuildingSupplyAggregate(payload, buildingId, initPageResult.req)

  return (
    <BuildingAggregateCardClient
      buildingId={String(buildingId)}
      count={aggregate.count}
      totalArea={aggregate.totalArea}
      rentRanges={aggregate.rentRanges}
    />
  )
}
