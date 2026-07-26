/**
 * 房源举报 fixture（tasks.md M6.1 / design §3.5 listing_reports / R5）
 *
 * 业务不变量（AGENTS.md §5.2）：
 *   - 举报状态机：pending-triage → assigned → verifying → awaiting-info → submitted-review → closed
 *   - 有效举报（sustained / partial）暂停供给可见性
 *   - 不改写审核状态和发布状态
 *
 * fixture 用途：
 *   - 单元测试：直接 import fixture，断言状态机与供给效果
 *   - 集成测试：通过 seed 脚本写入测试数据库
 */

import type {
  ReportConclusion,
  ReportReason,
  ReportStatus,
} from '@/domain/report/report-status'

export type ReportFixture = {
  id: string
  targetListingId: string
  reason: ReportReason
  reasonDetail?: string
  evidence: Array<{ image: number }>
  reporterName?: string
  reporterPhone?: string
  reporterIpHash?: string
  status: ReportStatus
  statusVersion: number
  assigneeId?: number
  conclusion?: ReportConclusion | null
  conclusionReason?: string | null
  supplyPaused: boolean
  supplyPausedAt?: string | null
  supplyResumedAt?: string | null
}

/** 最小举报：仅房源 + 原因，待分诊状态 */
export const REPORT_FIXTURE_MINIMAL: ReportFixture = {
  id: 'report-minimal',
  targetListingId: 'listing-published-clean',
  reason: 'false-info',
  reasonDetail: '房源描述与实际不符',
  evidence: [],
  status: 'pending-triage',
  statusVersion: 1,
  supplyPaused: false,
}

/** 带证据举报：3 张图片证据 */
export const REPORT_FIXTURE_WITH_EVIDENCE: ReportFixture = {
  id: 'report-with-evidence',
  targetListingId: 'listing-published-clean',
  reason: 'price-anomaly',
  reasonDetail: '挂牌价明显高于市场均价',
  evidence: [{ image: 1 }, { image: 2 }, { image: 3 }],
  reporterName: '张三',
  reporterPhone: '13800138000',
  reporterIpHash: 'a1b2c3d4e5f6',
  status: 'pending-triage',
  statusVersion: 1,
  supplyPaused: false,
}

/** 已关闭 - 举报成立：sustained 结论，供给已暂停 */
export const REPORT_FIXTURE_CLOSED_SUSTAINED: ReportFixture = {
  id: 'report-closed-sustained',
  targetListingId: 'listing-published-pending-recheck',
  reason: 'leased-not-delisted',
  reasonDetail: '房源已出租但仍在前台展示',
  evidence: [{ image: 10 }, { image: 11 }],
  reporterName: '李四',
  reporterPhone: '13900139000',
  reporterIpHash: 'b2c3d4e5f6a7',
  status: 'closed',
  statusVersion: 6,
  conclusion: 'sustained',
  conclusionReason: '经核实房源已出租，举报成立，已暂停供给。',
  supplyPaused: true,
  supplyPausedAt: '2026-07-20T10:00:00.000Z',
  supplyResumedAt: null,
}

/** 已关闭 - 举报不成立：dismissed 结论，供给未暂停 */
export const REPORT_FIXTURE_CLOSED_DISMISSED: ReportFixture = {
  id: 'report-closed-dismissed',
  targetListingId: 'listing-published-clean',
  reason: 'price-anomaly',
  reasonDetail: '举报人称价格异常',
  evidence: [],
  reporterName: '王五',
  reporterPhone: '13700137000',
  reporterIpHash: 'c3d4e5f6a7b8',
  status: 'closed',
  statusVersion: 4,
  conclusion: 'dismissed',
  conclusionReason: '经核实价格在合理区间，举报不成立。',
  supplyPaused: false,
  supplyPausedAt: null,
  supplyResumedAt: null,
}

/** 已关闭 - 部分成立：partial 结论，供给已暂停 */
export const REPORT_FIXTURE_CLOSED_PARTIAL: ReportFixture = {
  id: 'report-closed-partial',
  targetListingId: 'listing-published-clean',
  reason: 'false-info',
  reasonDetail: '部分描述与实际不符',
  evidence: [{ image: 20 }],
  status: 'closed',
  statusVersion: 5,
  conclusion: 'partial',
  conclusionReason: '面积描述有误但其他信息属实，部分成立。',
  supplyPaused: true,
  supplyPausedAt: '2026-07-22T14:00:00.000Z',
  supplyResumedAt: null,
}

/** 全部举报 fixture（用于遍历断言） */
export const REPORTS: Record<string, ReportFixture> = {
  'report-minimal': REPORT_FIXTURE_MINIMAL,
  'report-with-evidence': REPORT_FIXTURE_WITH_EVIDENCE,
  'report-closed-sustained': REPORT_FIXTURE_CLOSED_SUSTAINED,
  'report-closed-dismissed': REPORT_FIXTURE_CLOSED_DISMISSED,
  'report-closed-partial': REPORT_FIXTURE_CLOSED_PARTIAL,
}
