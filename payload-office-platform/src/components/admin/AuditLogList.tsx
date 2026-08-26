import type { ListViewServerPropsOnly, Where } from 'payload'

import {
  buildPermissionContext,
  hasOperationPermission,
} from '@/domain/auth/permission-context'
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_RESULTS,
  AUDIT_RESULT_LABELS,
} from '@/domain/audit/audit-types'
import type { AuditLog, Role, User } from '@/payload-types'
import AuditLogListClient, { type AuditLogRow } from './AuditLogListClient'

/**
 * 审计日志列表 - 服务端入口（后台表单优化 · 抽屉交互第一批）
 *
 * 整页替换 audit-logs 默认列表视图：服务端分页 + 动作/结果筛选，
 * 详情在客户端抽屉中按需经 REST /api/audit-logs/:id 拉取。
 *
 * 注册：AuditLogs.admin.components.views.list.Component
 *
 * 权限：
 *   - audit:view 决定能否进入本视图（与 collection access.read 一致）
 *   - audit:before_after 只透传给客户端做提示文案；脱敏本身由服务端
 *     afterRead hook 在 REST 单条读取时按真实用户权限执行
 *
 * 列表查询使用 overrideAccess: true（视图内已自行做 audit:view 门禁），
 * 亦因此不会触发 audit.view_detail 详情查看审计（批量读取本就不触发，
 * 与默认列表行为一致）；只有用户点开抽屉的单条 REST 读取才被审计。
 */

const PAGE_SIZE = 25

/** searchParams 值归一（string | string[] → string | null）。 */
function firstParam(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0]
  }
  return null
}

export default async function AuditLogList({
  payload,
  user,
  searchParams,
}: ListViewServerPropsOnly) {
  // 当前用户权限上下文（列表视图无 req，按审核台同款方式构造）
  const ctx = user
    ? await buildPermissionContext({
        user: user as unknown as Pick<
          User,
          'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'
        >,
        loadRoles: async (roleIds) => {
          const docs = await payload.find({
            collection: 'roles',
            where: { id: { in: roleIds } },
            depth: 0,
            overrideAccess: true,
            limit: roleIds.length,
          })
          return docs.docs as unknown as Role[]
        },
      })
    : null

  const canView = ctx ? hasOperationPermission(ctx, 'audit:view') : false
  const canViewBeforeAfter = ctx ? hasOperationPermission(ctx, 'audit:before_after') : false

  if (!ctx || !canView) {
    return (
      <div className="audit-log-list">
        <div className="audit-log-list__empty">暂无权限访问审计日志</div>
      </div>
    )
  }

  // 筛选与分页（URL searchParams 驱动，服务端过滤）
  const params = searchParams ?? {}
  const actionFilter = firstParam(params.action)
  const resultFilter = firstParam(params.result)
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1)

  const conditions: Where[] = []
  if (actionFilter && AUDIT_ACTIONS.includes(actionFilter as never)) {
    conditions.push({ action: { equals: actionFilter } })
  }
  if (resultFilter === 'success' || resultFilter === 'failed') {
    conditions.push({ result: { equals: resultFilter } })
  }

  const result = await payload.find({
    collection: 'audit-logs',
    where: conditions.length > 0 ? { and: conditions } : undefined,
    depth: 0,
    limit: PAGE_SIZE,
    page,
    sort: '-occurredAt',
    overrideAccess: true,
  })

  // 列表行只带摘要字段；before/after 等大字段留给抽屉按需拉取
  const rows: AuditLogRow[] = (result.docs as AuditLog[]).map((doc) => ({
    id: doc.id,
    auditId: doc.auditId,
    action: doc.action,
    result: doc.result,
    objectCollection: doc.objectCollection,
    objectId: doc.objectId,
    subjectUserId: doc.subjectUserId ?? null,
    requestId: doc.requestId ?? null,
    occurredAt: doc.occurredAt,
  }))

  return (
    <AuditLogListClient
      rows={rows}
      page={result.page ?? 1}
      pageSize={PAGE_SIZE}
      totalDocs={result.totalDocs ?? 0}
      totalPages={result.totalPages ?? 1}
      actionOptions={AUDIT_ACTIONS.map((value) => ({
        value,
        label: AUDIT_ACTION_LABELS[value] ?? value,
      }))}
      resultOptions={AUDIT_RESULTS.map((value) => ({
        value,
        label: AUDIT_RESULT_LABELS[value] ?? value,
      }))}
      activeAction={actionFilter}
      activeResult={resultFilter === 'success' || resultFilter === 'failed' ? resultFilter : null}
      canViewBeforeAfter={canViewBeforeAfter}
    />
  )
}
