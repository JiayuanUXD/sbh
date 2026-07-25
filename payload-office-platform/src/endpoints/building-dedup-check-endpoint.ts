import type { Endpoint } from 'payload'

import { findBuildingDuplicates } from '@/domain/supply/building-dedup-service'

/**
 * 楼盘查重 endpoint（tasks.md M3.2 / R3, R8）
 *
 * GET /api/buildings/dedup-check?name=&cityId=&latitude=&longitude=&excludeId=
 *
 * 语义：独立查重端点，不阻断保存。前端在保存前/中调用，拿到候选详情
 * 后由人决定是否合并（合并是另一个端点、另一个人为动作）。
 *
 * 响应：
 *   - 200: { ok: true, report: { hasDuplicate, total, candidates[] } }
 *   - 401: 未登录（查重属后台维护能力）
 *
 * 安全：
 *   - 必须登录
 *   - 查询以 overrideAccess: true 保证同城候选完整（查重是完整性判定，不做数据脱敏）
 */
export function createBuildingDedupCheckEndpoint(): Endpoint {
  return {
    path: '/buildings/dedup-check',
    method: 'get',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      const query = (req.query ?? {}) as Record<string, unknown>
      const report = await findBuildingDuplicates(
        req.payload,
        {
          name: strParam(query.name),
          cityId: idParam(query.cityId),
          latitude: numParam(query.latitude),
          longitude: numParam(query.longitude),
          excludeId: idParam(query.excludeId) ?? undefined,
        },
        req,
      )
      return Response.json({ ok: true, report })
    },
  }
}

// ────────────────────────────────────────────────────────────
// query 取参：query 值为字符串（或数组），需容错解析
// ────────────────────────────────────────────────────────────

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function strParam(value: unknown): string | null {
  const v = firstValue(value)
  return typeof v === 'string' ? v : null
}

/** id 参数：数字字符串转数字，非数字字符串原样保留（支持 uuid），空 → null。 */
function idParam(value: unknown): number | string | null {
  const v = firstValue(value)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && String(n) === v ? n : v
}

function numParam(value: unknown): number | null {
  const v = firstValue(value)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string' || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
