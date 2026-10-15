import type { LeadStage } from '@/domain/crm/lead-stage'

/**
 * 小程序「我的 › 咨询记录」给客户看的状态文案（OPT-117）。
 *
 * 线索阶段是销售侧的流程概念（待分配、有效商机、已流失……），CRM 后台用
 * `LEAD_STAGE_LABELS` 展示。此前小程序接口直接复用那张表，客户会看到自己的咨询
 * 被标成「已流失」。这里按客户能感知的进展合并：分配前都是「已提交」，分配到
 * 确认为有效商机都是「顾问跟进中」。
 *
 * 小程序 `services/user-assets.ts` 有同一张表，以本地表为展示事实源；两边措辞
 * 不一致时客户端显示本地文案，不会让整份响应失效。
 */
export const MINI_INQUIRY_STATUS_LABELS: Readonly<Record<LeadStage, string>> = {
  new: '已提交',
  pending_assignment: '已提交',
  following: '顾问跟进中',
  qualified: '顾问跟进中',
  viewing: '已安排看房',
  negotiation: '洽谈中',
  converted: '已完成',
  lost: '已结束',
}
