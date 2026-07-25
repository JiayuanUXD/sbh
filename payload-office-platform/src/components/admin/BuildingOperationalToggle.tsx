import type { DocumentViewServerProps } from 'payload'

import BuildingOperationalToggleClient from './BuildingOperationalToggleClient'

/**
 * 楼盘启停按钮 - 服务端（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条）
 *
 * 落点：楼盘编辑视图 `beforeDocumentControls`(与聚合卡片同区)。仅从已保存文档抽取
 * 序列化字段(id / operationalStatus / name)交给客户端;真正的权限门(building:freeze)
 * 与状态翻转在 endpoint 服务端强制,本组件不做任何判定(执行原则 line 7)。
 *
 * 新建(未保存)楼盘无 id → 不渲染(无可启停对象)。operationalStatus 缺省按 'active'
 * 兜底(与 Buildings.ts 字段 defaultValue 一致),避免服务端首帧读到 undefined。
 */
export default function BuildingOperationalToggle({ doc }: DocumentViewServerProps) {
  const building = doc as unknown as {
    id?: number | string
    operationalStatus?: unknown
    name?: unknown
  }
  const buildingId = building?.id
  if (buildingId === undefined || buildingId === null || buildingId === '') return null

  const operationalStatus =
    building.operationalStatus === 'disabled' ? 'disabled' : 'active'
  const name = typeof building.name === 'string' ? building.name : ''

  return (
    <BuildingOperationalToggleClient
      buildingId={String(buildingId)}
      operationalStatus={operationalStatus}
      buildingName={name}
    />
  )
}
