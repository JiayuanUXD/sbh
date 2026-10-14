import type { PayloadRequest } from 'payload'

import { withAudit } from '@/domain/audit/with-audit'

import { isBuildingOperationalStatus, type BuildingOperationalStatus } from './building'

/**
 * 单个楼盘停用 / 启用的执行核心（OPT-113）。
 *
 * 编辑页 / 列表行的 `POST /api/buildings/:id/toggle-operational-status` 与批量
 * `POST /api/buildings/batch-operational-status` 都调这一个函数：读取、版本校验、幂等判断、
 * 写入与审计只有一份。**鉴权不在这里**（两个端点各自先过 building:freeze）。
 *
 * 语义：
 *   - 只写 `operationalStatus`，绝不触碰发布状态 `status` 与任何房源（R3：停用只从有效供给
 *     谓词的楼盘侧撤销可见性，不改写关联房源的审核 / 发布状态）。
 *   - `target` 为 null 表示「翻转」（编辑页旧调用方式）；否则按目标值写。
 *   - 已是目标状态 → 幂等成功（`changed: false`），不写库、不写审计。
 *   - 每次实际写入记一行审计：停用 `building.freeze`，启用 `building.restore`
 *     （两个枚举值早已在 audit_logs.action 里，无需迁移）。审计失败按 M8.2 视为失败。
 *
 * 可预期的失败以 `{ ok: false, status }` 返回；`payload.update` 自身抛的异常照常抛出，
 * 单条端点交给 Payload 统一错误处理，批量端点逐条兜住。
 */

export type BuildingOperationalOutcome =
  | { ok: true; operationalStatus: BuildingOperationalStatus; changed: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; code?: string }

export async function setBuildingOperationalStatus(
  req: PayloadRequest,
  params: {
    buildingId: string | number
    /** null = 翻转 */
    target: BuildingOperationalStatus | null
    /** 显式传入时必须与库里的 version 一致 */
    expectedVersion?: number | null
  },
): Promise<BuildingOperationalOutcome> {
  const { buildingId, target, expectedVersion } = params

  let building: Record<string, unknown>
  try {
    building = (await req.payload.findByID({
      collection: 'buildings',
      id: buildingId,
      depth: 0,
      req,
    })) as unknown as Record<string, unknown>
  } catch {
    return { ok: false, status: 404, error: '楼盘不存在' }
  }

  if (
    expectedVersion !== undefined &&
    expectedVersion !== null &&
    building.version !== expectedVersion
  ) {
    return {
      ok: false,
      status: 409,
      error: '楼盘已被他人修改，请刷新后重试',
      code: 'VERSION_CONFLICT',
    }
  }

  const current = building.operationalStatus
  if (!isBuildingOperationalStatus(current)) {
    return { ok: false, status: 400, error: '楼盘当前启停状态非法，无法翻转' }
  }

  const next: BuildingOperationalStatus = target ?? (current === 'active' ? 'disabled' : 'active')
  if (next === current) {
    return { ok: true, operationalStatus: current, changed: false }
  }

  const result = await withAudit({
    req,
    action: next === 'disabled' ? 'building.freeze' : 'building.restore',
    object: {
      collection: 'buildings',
      objectId: buildingId,
      objectVersion: typeof building.version === 'number' ? building.version : 1,
    },
    before: building,
    fn: async () => {
      const updated = await req.payload.update({
        collection: 'buildings',
        id: buildingId,
        data: { operationalStatus: next },
        req, // 透传 req → auditFieldsPlugin 记录 lastModifiedBy；afterChange 失效公开缓存
      })
      return {
        ok: true as const,
        data: next,
        after: updated as unknown as Record<string, unknown>,
        changedFields: ['operationalStatus'],
      }
    },
    throwOnError: false,
  })

  if (result === null) {
    return { ok: false, status: 500, error: '写入失败，请重试' }
  }
  return { ok: true, operationalStatus: result, changed: true }
}
