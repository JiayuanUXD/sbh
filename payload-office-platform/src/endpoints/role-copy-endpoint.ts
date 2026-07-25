import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { copyRole } from '@/domain/auth/role-copy'

/**
 * 角色复制 endpoint（tasks.md M1.5）
 *
 * POST /api/roles/:id/copy
 *
 * 请求体：
 *   {
 *     "code": "CUSTOM_OPS_LITE",  // 新角色编码，必填
 *     "name": "运营精简版"          // 新角色名称，可选
 *   }
 *
 * 响应：
 *   - 200: { ok: true, role: {...} }
 *   - 400: { ok: false, error: "..." }
 *   - 403: 无权限
 *   - 404: 源角色不存在
 *
 * 安全：
 *   - 必须登录
 *   - 必须具备 role:manage 操作权限（仅 ADM 默认拥有）
 */
export function createRoleCopyEndpoint(): Endpoint {
  return {
    path: '/roles/:id/copy',
    method: 'post',
    handler: async (req) => {
      // 1. 鉴权：必须具备 role:manage 权限
      try {
        await requireOperationPermission(req as RequestContext, 'role:manage')
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json(
          { ok: false, error: message },
          { status },
        )
      }

      // 2. 解析参数
      // Payload 3.86 的路由参数在 req.routeParams（不是 req.params）；
      // 见 payload/dist/types/index.d.ts 的 PayloadRequest.routeParams。
      // 之前误用 req.params → id 恒 undefined → 复制恒返回 400（本次修复点）。
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const id =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (id === undefined || id === '') {
        return Response.json(
          { ok: false, error: '缺少源角色 ID' },
          { status: 400 },
        )
      }

      const body = await parseBody(req)
      const newCode = typeof body.code === 'string' ? body.code.trim() : ''
      const newName = typeof body.name === 'string' ? body.name.trim() : undefined
      if (!newCode) {
        return Response.json(
          { ok: false, error: '缺少新角色编码（code）' },
          { status: 400 },
        )
      }

      // 3. 调用领域服务
      const result = await copyRole(req.payload, {
        sourceId: id,
        newCode,
        newName,
      })

      if (!result.ok) {
        // 区分错误类型：源角色不存在 → 404；其他 → 400
        const isNotFound = result.error.includes('源角色不存在')
        return Response.json(
          { ok: false, error: result.error },
          { status: isNotFound ? 404 : 400 },
        )
      }

      return Response.json({ ok: true, role: result.role })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助：解析请求体
// ────────────────────────────────────────────────────────────

async function parseBody(req: import('payload').PayloadRequest): Promise<{
  code?: unknown
  name?: unknown
}> {
  try {
    if (req.json && typeof req.json === 'function') {
      return await req.json()
    }
    // 兜底：req.body
    if (req.body) {
      return req.body as { code?: unknown; name?: unknown }
    }
  } catch {
    // 忽略解析失败
  }
  return {}
}
