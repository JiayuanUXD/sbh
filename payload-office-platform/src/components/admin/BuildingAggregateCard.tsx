import type { Payload } from 'payload'

import { computeBuildingSupplyAggregate } from '@/domain/supply/building-aggregate'
import BuildingAggregateCardClient from './BuildingAggregateCardClient'

/**
 * 楼盘有效房源聚合卡片 - 表单字段组件（tasks.md M3.4「展示有效房源套数、面积和租金聚合」/ R3）
 *
 * 落点：楼盘编辑视图表单顶部（ui 字段），占满主内容区宽度。
 * 原先挂在 beforeDocumentControls（右侧按钮区，宽度仅 ~290px），Descriptions 两列
 * 布局严重挤压——改为 ui 字段后模块在表单区顶部渲染，有充足空间。
 *
 * 口径：computeBuildingSupplyAggregate 走 M4.7 统一有效供给口径——查询层
 *   getEffectiveSupplyWhere（§1-4 状态 + §7 楼盘/城市/行政区在营）+ §5 举报暂停排除,
 *   取候选后逐条精筛（媒体 §6 / 关系 §8 / 商户 §9-§10），与前台 / 详情结论一致。
 *
 * 新建（未保存）楼盘无 id → 无可聚合对象 → 不渲染卡片。
 */
type FieldProps = Readonly<{
  payload: Payload
  data?: Readonly<{ id?: string | number }> & Record<string, unknown>
  id?: string | number
}>

export default async function BuildingAggregateCard({ payload, data, id }: FieldProps) {
  const docId = id ?? data?.id
  if (docId === undefined || docId === null || docId === '') return null

  const aggregate = await computeBuildingSupplyAggregate(payload, docId, undefined, {
    overrideAccess: true,
  })

  return (
    <BuildingAggregateCardClient
      buildingId={String(docId)}
      count={aggregate.count}
      totalArea={aggregate.totalArea}
      rentRanges={aggregate.rentRanges}
    />
  )
}
