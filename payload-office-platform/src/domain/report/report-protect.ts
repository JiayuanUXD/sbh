/**
 * 房源举报权限守卫与 Collection 保护 hook（tasks.md M6.1 / design §3.5 / R5, R8）
 *
 * 职责：
 *   - ListingReports Collection 的 beforeChange hook：校验枚举、推导状态版本号
 *   - 不直接执行状态转换（转换由 endpoint 调用 transitionReportStatus 完成），
 *     但在 create 时初始化 status=pending-triage、statusVersion=1
 *   - 在 update 时校验 status 转换合法（防止绕过 endpoint 直接改 status）
 *   - 关闭（status=closed）必须带 conclusion + conclusionReason
 *
 * 权限编码（permission-codes.ts）：
 *   - report:read     读取举报列表 / 详情
 *   - report:manage   编辑 / 删除举报记录
 *   - report:triage   分诊 / 领取（业务动作权限，由 endpoint 校验）
 *   - report:resolve  核实 / 关闭（业务动作权限，由 endpoint 校验）
 *
 * Collection access 与 protect hook 双层兜底：
 *   - access 在 HTTP 层挡无权限请求
 *   - protect hook 在 Local API 层兜底（防绕过 REST）
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'
import {
  canTransitionReport,
  isReportConclusion,
  isReportReason,
  isReportStatus,
  isTerminalStatus,
  type ReportStatus,
} from './report-status'

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
 */
export const protectListingReport: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
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
    return data
  }

  // —— update 路径 ——
  if (operation === 'update' && originalDoc) {
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
