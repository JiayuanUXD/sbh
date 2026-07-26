/**
 * 房源举报权限守卫与 Collection 保护 hook（tasks.md M6.1-M6.2 / design §3.5 / R5, R8）
 *
 * 职责：
 *   - ListingReports Collection 的 beforeChange hook：校验枚举、推导状态版本号
 *   - 不直接执行状态转换（转换由 endpoint 调用 transitionReportStatus 完成），
 *     但在 create 时初始化 status=pending-triage、statusVersion=1
 *   - 在 update 时校验 status 转换合法（防止绕过 endpoint 直接改 status）
 *   - 关闭（status=closed）必须带 conclusion + conclusionReason
 *   - M6.2 新增：供给暂停字段（supplyPaused / supplyPausedAt / supplyResumedAt）
 *     被修改时要求 'report:resolve' 权限（恢复和关闭要求权限、原因和审计）
 *
 * 权限编码（permission-codes.ts）：
 *   - report:read     读取举报列表 / 详情
 *   - report:manage   编辑 / 删除举报记录
 *   - report:triage   分诊 / 领取（业务动作权限，由 endpoint 校验）
 *   - report:resolve  核实 / 关闭 / 暂停 / 恢复供给（业务动作权限，由 endpoint + protect hook 双层校验）
 *
 * Collection access 与 protect hook 双层兜底：
 *   - access 在 HTTP 层挡无权限请求
 *   - protect hook 在 Local API 层兜底（防绕过 REST）
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import {
  canTransitionReport,
  isReportConclusion,
  isReportReason,
  isReportStatus,
  isTerminalStatus,
  type ReportStatus,
} from './report-status'

/** 供给暂停相关字段集合：修改这些字段需要 report:resolve 权限。 */
const SUPPLY_PAUSE_FIELDS = ['supplyPaused', 'supplyPausedAt', 'supplyResumedAt'] as const

/**
 * beforeChange hook：举报记录写入前校验与初始化。
 *
 * create：
 *   - 校验 reason 合法（防绕过 admin select 直接打 REST）
 *   - 初始化 status=pending-triage（不接受客户端指定）
 *   - 初始化 statusVersion=1
 *   - 初始化 supplyPaused=false（举报创建时不立即暂停供给）
 *
 * update：
 *   - 如果客户端改了 status，校验转换合法（防绕过 endpoint 直接改状态）
 *   - statusVersion 自增（由 endpoint 控制，此处只兜底防漏）
 *   - closed 必须有 conclusion + conclusionReason
 *   - 修改供给暂停字段（supplyPaused / supplyPausedAt / supplyResumedAt）
 *     需要 'report:resolve' 权限（M6.2 新增，AGENTS.md §5.2 恢复和关闭要求权限）
 */
export const protectListingReport: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— reason 枚举校验（create / update 都校验）——
  if (data?.reason !== undefined && data?.reason !== null && data?.reason !== '') {
    if (!isReportReason(data.reason as unknown)) {
      throw new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_REASON_INVALID',
        message: '举报原因码非法',
        details: { reason: data.reason },
      })
    }
  }

  // —— evidence 数量上限校验（最多 5 张）——
  if (Array.isArray(data?.evidence) && data.evidence.length > 5) {
    throw new InvalidOperationError({
      domain: 'report',
      code: 'REPORT_EVIDENCE_TOO_MANY',
      message: '举报证据最多 5 张',
      details: { count: data.evidence.length },
    })
  }

  if (operation === 'create') {
    // —— 初始化 status / statusVersion（不接受客户端指定 status）——
    data.status = 'pending-triage' as ReportStatus
    data.statusVersion = 1
    data.supplyPaused = false
    // create 时不允许直接带 conclusion / conclusionReason（必须通过关闭流程）
    delete data.conclusion
    delete data.conclusionReason
    // create 时不允许直接带 supplyPausedAt / supplyResumedAt（由供给暂停服务设置）
    delete data.supplyPausedAt
    delete data.supplyResumedAt
    return data
  }

  // —— update 路径 ——
  if (operation === 'update' && originalDoc) {
    // —— M6.2 新增：供给暂停字段修改需要 'report:resolve' 权限 ——
    // 防止绕过 endpoint 直接 PATCH supplyPaused / supplyResumedAt
    // 内部通过 endpoint 调用且 req.user 为空（overrideAccess）时跳过；
    // 兼容历史测试与脚本调用：req 缺失时跳过权限校验
    if (req?.user) {
      const touchedSupplyField = SUPPLY_PAUSE_FIELDS.some((field) => {
        const next = (data as Record<string, unknown> | undefined)?.[field]
        const prev = (originalDoc as Record<string, unknown>)[field]
        return next !== undefined && next !== prev
      })
      if (touchedSupplyField) {
        const ctx = await getPermissionContext(req as RequestContext)
        if (!ctx || !hasOperationPermission(ctx, 'report:resolve')) {
          throw new ForbiddenError({
            domain: 'report',
            message: '修改供给暂停字段需要操作权限：report:resolve',
            details: { requiredOperation: 'report:resolve' },
          })
        }
      }
    }

    const currentStatus = (originalDoc as { status?: unknown }).status
    const targetStatus = data?.status

    // 如果改了 status，校验转换合法
    if (
      targetStatus !== undefined &&
      targetStatus !== null &&
      targetStatus !== currentStatus
    ) {
      if (!isReportStatus(currentStatus)) {
        throw new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_CURRENT_STATUS_INVALID',
          message: '举报当前状态非法',
          details: { currentStatus },
        })
      }
      if (!isReportStatus(targetStatus)) {
        throw new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_TARGET_STATUS_INVALID',
          message: '举报目标状态非法',
          details: { targetStatus },
        })
      }
      // 终态不可再流转
      if (isTerminalStatus(currentStatus)) {
        throw new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_TERMINAL_STATUS',
          message: '举报已关闭，不可再修改状态',
          details: { currentStatus, targetStatus },
        })
      }
      // 合法转换表
      if (!canTransitionReport(currentStatus, targetStatus)) {
        throw new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_ILLEGAL_TRANSITION',
          message: `举报不允许从 ${currentStatus} 切换到 ${targetStatus}`,
          details: { currentStatus, targetStatus },
        })
      }
      // 关闭必须有 conclusion + conclusionReason
      if (targetStatus === 'closed') {
        if (!isReportConclusion(data?.conclusion)) {
          throw new InvalidOperationError({
            domain: 'report',
            code: 'REPORT_CONCLUSION_REQUIRED',
            message: '关闭举报必须填写结论',
          })
        }
        if (
          typeof data?.conclusionReason !== 'string' ||
          (data.conclusionReason as string).trim().length === 0
        ) {
          throw new InvalidOperationError({
            domain: 'report',
            code: 'REPORT_CONCLUSION_REASON_REQUIRED',
            message: '关闭举报必须填写结论原因',
          })
        }
        // —— M6.2 自动推导供给暂停状态（design §3.5 / R5）——
        // 服务端推导，不需要用户提交 supplyPaused；用户在 status 转换路径下
        // 提交的 supplyPaused 会被覆盖（防绕过权限）。
        //   - sustained / partial → supplyPaused=true, supplyPausedAt=now
        //   - dismissed           → supplyPaused=false, supplyResumedAt=null
        // supplyPausedAt / supplyResumedAt 仅在状态变化时设置，后续手动恢复
        // 由 endpoint 调用 resumeSupplyForReport 并 PATCH supplyResumedAt。
        const conclusion = data?.conclusion
        if (isReportConclusion(conclusion)) {
          if (conclusion === 'sustained' || conclusion === 'partial') {
            data.supplyPaused = true
            // 仅在首次暂停时设置时间戳；如果已暂停（重复 close 路径不应发生，
            // 但兜底），保留原 supplyPausedAt
            if (!(originalDoc as { supplyPausedAt?: unknown }).supplyPausedAt) {
              data.supplyPausedAt = new Date().toISOString()
            }
            data.supplyResumedAt = null
          } else if (conclusion === 'dismissed') {
            data.supplyPaused = false
            // dismissed 视为"未暂停"，清除时间戳
            data.supplyPausedAt = null
            data.supplyResumedAt = null
          }
        }
      }
      // statusVersion 自增（由 endpoint 控制版本，此处兜底防漏）
      const currentVersion =
        typeof (originalDoc as { statusVersion?: unknown }).statusVersion === 'number'
          ? ((originalDoc as { statusVersion: number }).statusVersion)
          : 1
      data.statusVersion = currentVersion + 1
    }

    return data
  }

  return data
}
