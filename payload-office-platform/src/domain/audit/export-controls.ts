/**
 * 受控导出装配（domain/audit/export-controls）
 *
 * tasks.md M3.4 子项 4「完成……导出动作」/ 执行原则 line 7「每项业务操作必须先完成
 * 服务端权限和审计,再开放后台按钮」/ R3。
 *
 * 导出是批量数据外流，属可审计的高风险动作。本模块复用
 * @payloadcms/plugin-import-export 自动生成的 `exports` 集合，只补三件事：
 *   1. access.create 挂 data:export 操作权限门（服务端强制，隐藏按钮不算权限）
 *   2. 批量上限 EXPORT_LIMIT（防一次性拉全库）
 *   3. export.hooks.after 每批落一条审计日志
 *
 * 为什么审计走 payload.logger 而非审计字段：`exports` 集合被 auditFieldsPlugin
 * 显式排除（见 payload.config.ts excludedCollections），不会自动记录 createdBy，
 * 故导出事件必须在此显式落日志。字段脱敏由 API 读取层继承（R1），本层不重复。
 */

import type { CollectionConfig, PayloadRequest } from 'payload'
import type { ExportAfterHook } from '@payloadcms/plugin-import-export/types'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'

/** 单次导出的文档数上限（防止一次性导出全库；0 表示不限，此处显式设正整数）。 */
export const EXPORT_LIMIT = 50 as const

/** 导出所需操作权限码（design.md §6.1 / permission-codes OPERATION_CODES）。 */
const EXPORT_PERMISSION = 'data:export' as const

type AccessCreate = NonNullable<NonNullable<CollectionConfig['access']>['create']>

/**
 * 构建 exports 集合 create 的权限门：仅具备 data:export 的登录用户可发起导出。
 *
 * - 未登录 / 停用账号 → PermissionContext 为 null → 拒绝
 * - 登录但缺 data:export → 拒绝
 * - 具备 data:export 或通配符 * → 放行
 *
 * 只从 req.user 派生上下文，客户端 body/query 不参与（与其他 access 工厂一致）。
 */
export function buildExportAccessCreate(): AccessCreate {
  return async ({ req }) => {
    const ctx = await getPermissionContext(req as RequestContext)
    if (!ctx) return false
    return hasOperationPermission(ctx, EXPORT_PERMISSION)
  }
}

/**
 * 覆盖插件生成的 exports 集合：把 data:export 门挂到 access.create，保留其余配置。
 *
 * 传给 importExportPlugin 的 overrideExportCollection。只替换 create，read/update/delete
 * 及字段、hooks 全部原样透传，避免与插件默认行为分裂。
 */
export function overrideExportsCollection({
  collection,
}: {
  collection: CollectionConfig
}): CollectionConfig {
  return {
    ...collection,
    access: {
      ...collection.access,
      create: buildExportAccessCreate(),
    },
  }
}

/**
 * 导出审计 after hook：每批写入文件后落一条结构化日志。
 *
 * 插件保证 hook 每批触发一次（totalBatches 为该次导出的总批数）。仅用于可观测与
 * 审计，返回值被插件忽略。绝不抛错以免阻断导出（导出本身是只读外流，审计失败
 * 不应回滚数据；高风险写操作的“审计失败即失败”另在写路径处理）。
 */
export function createExportAuditHook(): ExportAfterHook {
  return ({ batchNumber, data, format, totalBatches, req }) => {
    const user = req.user as { id?: number | string } | null | undefined
    const userId = user?.id ?? null
    // exports 集合创建时，目标集合 slug 挂在 req.data.collectionSlug 上（插件约定）。
    const collectionSlug =
      (req as PayloadRequest & { data?: { collectionSlug?: unknown } }).data?.collectionSlug ?? null
    req.payload.logger.info({
      event: EXPORT_PERMISSION,
      userId,
      collectionSlug,
      format,
      batchNumber,
      totalBatches,
      rowCount: Array.isArray(data) ? data.length : 0,
    })
  }
}
