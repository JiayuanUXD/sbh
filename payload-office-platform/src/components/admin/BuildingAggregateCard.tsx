import type { BeforeDocumentControlsServerProps } from 'payload'

import { computeBuildingSupplyAggregate } from '@/domain/supply/building-aggregate'
import BuildingAggregateCardClient from './BuildingAggregateCardClient'

/**
 * 楼盘有效房源聚合卡片 - 服务端（tasks.md M3.4「展示有效房源套数、面积和租金聚合」/ R3）
 *
 * 落点：楼盘编辑视图 `beforeDocumentControls`。R3 末条要求「预览楼盘时展示符合
 * 统一有效供给谓词的房源聚合」，编辑视图是正确落点（原生列表无法逐行跑异步聚合）。
 *
 * 口径：computeBuildingSupplyAggregate 走 M4.7 统一有效供给口径——查询层
 *   getEffectiveSupplyWhere（§1-4 状态 + §7 楼盘/城市/行政区在营）+ §5 举报暂停排除，
 *   取候选后逐条精筛（媒体 §6 / 关系 §8 / 商户 §9-§10），与前台 / 详情结论一致。
 *
 * ⚠️ 关键：Payload 3.86 的 `beforeDocumentControls` 槽只传 `ServerProps`
 * (`{ id, payload, user, i18n, locale, permissions }`)——**不含 `doc`/`req`**。
 * 因此从 props 直接取 `id`；聚合无法透传 req，改用 `overrideAccess: true` 出全量
 * 统计（编辑者已具备该文档访问权，卡片应展示楼盘真实有效供给,不做用户级脱敏）。
 *
 * 新建（未保存）楼盘无 id → 无可聚合对象 → 不渲染卡片。
 */
export default async function BuildingAggregateCard({
  id,
  payload,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '') return null

  const aggregate = await computeBuildingSupplyAggregate(payload, id, undefined, {
    overrideAccess: true,
  })

  return (
    <BuildingAggregateCardClient
      buildingId={String(id)}
      count={aggregate.count}
      totalArea={aggregate.totalArea}
      rentRanges={aggregate.rentRanges}
    />
  )
}
