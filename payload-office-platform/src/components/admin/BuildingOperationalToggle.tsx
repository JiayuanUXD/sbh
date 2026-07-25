import type { BeforeDocumentControlsServerProps } from 'payload'

import BuildingOperationalToggleClient from './BuildingOperationalToggleClient'

/**
 * 楼盘启停按钮 - 服务端（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条）
 *
 * 落点：楼盘编辑视图 `beforeDocumentControls`(与聚合卡片同区)。仅抽取序列化字段
 * (id / operationalStatus / name)交给客户端;真正的权限门(building:freeze)与状态
 * 翻转在 endpoint 服务端强制,本组件不做任何判定(执行原则 line 7)。
 *
 * ⚠️ 关键：Payload 3.86 的 `beforeDocumentControls` 槽只传 `ServerProps`
 * (`{ id, payload, user, i18n, locale, permissions }`)——**不含 `doc`/`req`**
 * (那些属于文档「视图」的 DocumentViewServerProps,不是控件槽)。因此这里从 props
 * 直接取 `id`,再用 `payload.findByID` 读回 operationalStatus / name。
 *
 * 新建(未保存)楼盘无 id → 不渲染(无可启停对象)。文档不存在时静默返回 null。
 */
export default async function BuildingOperationalToggle({
  id,
  payload,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '') return null

  let building: { operationalStatus?: unknown; name?: unknown } | null = null
  try {
    building = (await payload.findByID({
      collection: 'buildings',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as { operationalStatus?: unknown; name?: unknown }
  } catch {
    // 文档不存在或已删除 → 不渲染
    return null
  }
  if (!building) return null

  const operationalStatus =
    building.operationalStatus === 'disabled' ? 'disabled' : 'active'
  const name = typeof building.name === 'string' ? building.name : ''

  return (
    <BuildingOperationalToggleClient
      buildingId={String(id)}
      operationalStatus={operationalStatus}
      buildingName={name}
    />
  )
}
