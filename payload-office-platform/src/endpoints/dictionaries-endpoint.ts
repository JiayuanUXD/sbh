import type { Endpoint } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { listEnumDictionaries, getEnumDictionary } from '@/domain/dictionary/enum-registry'

/**
 * 字典发布基线 endpoint（tasks.md M2.6 / R2）
 *
 * GET /api/dictionaries
 *   - 列出全部只读枚举字典（核心状态、商户类型、强类型字段）
 *
 * GET /api/dictionaries/:code
 *   - 单个字典详情
 *
 * GET /api/dictionaries?includeDisplayTags=true
 *   - 同时返回可见的展示标签（visible=true 且 status=active）
 *
 * 语义：
 *   - 只读字典是发布基线，前端字典下拉、文档说明统一读取
 *   - 展示标签是可维护字典，按 visible + status 过滤
 *   - 历史快照（业务对象保存的 code+label）由业务对象自身存储，本端点只提供当前发布值
 *
 * 响应：
 *   - 200: { ok: true, dictionaries: [...] } 或 { ok: true, dictionary: {...} }
 *   - 401: 未登录
 *   - 403: 缺少 dictionary:manage 权限（仅展示标签维护需要）
 *   - 404: 字典 code 不存在
 *
 * 安全：
 *   - 必须登录（字典属后台维护能力）
 *   - 只读字典：所有已认证用户可读
 *   - 展示标签：按数据权限脱敏
 */
export function createDictionariesEndpoint(): Endpoint {
  return {
    path: '/dictionaries',
    method: 'get',
    handler: async (req) => {
      // 1. 鉴权：必须登录
      try {
        await requireAdminContext(req as RequestContext)
      } catch (err) {
        const message = err instanceof Error ? err.message : '未登录'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      const query = (req.query ?? {}) as Record<string, unknown>
      const code = strParam(query.code)
      const includeDisplayTags = query.includeDisplayTags === 'true'

      // 2. 单个字典查询
      if (code) {
        const dict = getEnumDictionary(code)
        if (!dict) {
          return Response.json(
            { ok: false, error: `字典 ${code} 不存在` },
            { status: 404 },
          )
        }
        return Response.json({ ok: true, dictionary: dict })
      }

      // 3. 列出全部只读枚举字典
      const dictionaries = listEnumDictionaries()

      // 4. 可选：附带可见的展示标签
      let displayTags: unknown = null
      if (includeDisplayTags) {
        const res = await req.payload.find({
          collection: 'display-tags' as never,
          where: {
            and: [
              { visible: { equals: true } },
              { status: { equals: 'active' } },
            ],
          },
          sort: 'sortOrder',
          limit: 500,
          depth: 0,
          overrideAccess: true,
          req,
        })
        displayTags = (res.docs as Array<{ code: string; name: string; sortOrder: number }>).map(
          (d) => ({ code: d.code, label: d.name, sortOrder: d.sortOrder }),
        )
      }

      return Response.json({ ok: true, dictionaries, displayTags })
    },
  }
}

function strParam(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}
