/**
 * Payload Collection 字段脱敏 hook 工厂（tasks.md M1.4, design.md §6.1）
 *
 * 用法（在 Collection 配置中）：
 *   ```ts
 *   import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
 *   import { getLeadMaskRules } from '@/domain/auth/field-mask'
 *
 *   hooks: {
 *     afterRead: createFieldMaskHooks(getLeadMaskRules()),
 *   }
 *   ```
 *
 * 行为：
 *   - overrideAccess=true 路径（payload 内部 / 后台管理、迁移脚本）→ 不脱敏
 *   - ctx=null（未登录或停用账号）→ 全部脱敏
 *   - ctx.fieldPermissions 命中 → 保留原值；否则脱敏
 *
 * 业务不变量（AGENTS.md §6）：
 *   - 禁止仅靠前端隐藏保护敏感字段
 *   - 字段脱敏在服务端 afterRead 完成；任何客户端参数都不能扩大字段可见性
 */

import type { CollectionAfterReadHook } from 'payload'
import { getPermissionContext, type RequestContext } from './access'
import { maskDocFields, type FieldMaskRule } from './field-mask'

/**
 * 创建字段脱敏 afterRead hook。
 *
 * 返回的 hook 接受单个 doc 或 docs 数组，就地脱敏后返回。
 * - overrideAccess=true → 跳过脱敏（保留原值）
 * - req.user=null → 全部脱敏
 */
export function createFieldMaskHooks(
  rules: readonly FieldMaskRule[],
): CollectionAfterReadHook[] {
  return [
    async ({ req, doc, overrideAccess }) => {
      if (overrideAccess) return doc
      const ctx = await getPermissionContext(req as RequestContext)
      // doc 可能是单文档或数组（Payload 在 find 时可能传入数组）
      if (Array.isArray(doc)) {
        return doc.map((d) => maskDocFields({ ...(d as object) }, rules, ctx))
      }
      return maskDocFields({ ...(doc as object) }, rules, ctx)
    },
  ]
}
