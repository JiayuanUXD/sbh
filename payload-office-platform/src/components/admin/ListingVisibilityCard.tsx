import type { Payload } from 'payload'

import {
  createEffectiveSupplyPayloadPort,
} from '@/domain/review/effective-supply-payload-port'
import {
  getPausedListingIds,
  isListingPaused,
} from '@/domain/review/effective-supply'
import ListingVisibilityCardClient from './ListingVisibilityCardClient'

/**
 * 房源编辑页「前台可见性」卡片 - 服务端取数（OPT-030 §4 第一层）
 *
 * 落点：Listings 编辑视图表单顶部 ui 字段（与楼盘编辑页 BuildingAggregateCard
 * 同一先例：侧栏/控件区宽度不足以承载逐条检查，放表单区顶部）。
 *
 * 取数只有一项需要服务端：举报暂停（§5）--复用统一有效供给服务
 * getPausedListingIds + isListingPaused，不自拼举报查询（.agent/supply.md
 * 「唯一服务」约束）。其余自身条件（发布/审核/冻结/图集）由客户端组件直接
 * 读表单值，实时反映未保存的编辑。
 *
 * 新建（未保存）房源无 id -> 不可能被举报，reportPaused=false，卡片照常
 * 引导（任务包来源即「把前台展示限制前移到新建/修改链路」）。
 */
type FieldProps = Readonly<{
  payload: Payload
  data?: Readonly<{ id?: string | number }> & Record<string, unknown>
  id?: string | number
}>

export default async function ListingVisibilityCard({ payload, data, id }: FieldProps) {
  const docId = id ?? data?.id
  const listingId =
    docId === undefined || docId === null || docId === '' ? null : String(docId)

  let reportPaused = false
  if (listingId !== null) {
    // 查询层一次性取全部暂停举报再按 id 判断；overrideAccess 由领域服务内部保证。
    const pausedIds = await getPausedListingIds(createEffectiveSupplyPayloadPort(payload))
    reportPaused = isListingPaused(pausedIds, listingId)
  }

  return <ListingVisibilityCardClient listingId={listingId} reportPaused={reportPaused} />
}
