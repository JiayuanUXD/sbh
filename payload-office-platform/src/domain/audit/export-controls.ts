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
import { writeAuditSuccess } from './audit-writer'

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
    admin: {
      ...collection.admin,
      group: false,
    },
    access: {
      ...collection.access,
      create: buildExportAccessCreate(),
    },
  }
}

/** 覆盖插件生成的 imports 集合：退出默认导航，同时保留插件全部既有配置。 */
export function overrideImportsCollection({
  collection,
}: {
  collection: CollectionConfig
}): CollectionConfig {
  return {
    ...collection,
    admin: {
      ...collection.admin,
      group: false,
    },
  }
}

/**
 * 导出审计 after hook：每批写入文件后落一条审计日志（audit-logs collection）。
 *
 * 插件保证 hook 每批触发一次（totalBatches 为该次导出的总批数）。
 *
 * M8.1 升级：从 logger.info 改为写入 audit-logs collection（append-only）。
 * M8.2 语义：导出是只读数据外流，审计失败不回滚（没有数据变更），但记录失败到 console。
 *
 * 第 1 批时 objectVersion=1，后续批次递增（用于区分同一导出的不同批次）。
 */
export function createExportAuditHook(): ExportAfterHook {
  return async ({ batchNumber, data, format, totalBatches, req }) => {
    const user = req.user as { id?: number | string } | null | undefined
    const userId = user?.id ?? null
    const collectionSlug =
      (req as PayloadRequest & { data?: { collectionSlug?: unknown } }).data?.collectionSlug ?? null

    const rowCount = Array.isArray(data) ? data.length : 0

    try {
      await writeAuditSuccess({
        payload: req.payload,
        req,
        data: {
          action: 'data.export',
          object: {
            collection: typeof collectionSlug === 'string' ? collectionSlug : 'unknown',
            objectId: `export-batch-${batchNumber}-of-${totalBatches}`,
            objectVersion: typeof batchNumber === 'number' ? batchNumber : 1,
          },
          after: {
            format,
            batchNumber,
            totalBatches,
            rowCount,
            userId,
          },
          changedFields: ['exportBatch'],
        },
      })
    } catch (err) {
      // 导出审计失败不阻断导出（只读外流，无数据变更需要回滚）
      console.warn('[audit] export audit write failed:', err)
    }
  }
}
