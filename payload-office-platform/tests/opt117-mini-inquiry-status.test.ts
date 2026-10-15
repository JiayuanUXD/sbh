import { describe, expect, it } from 'vitest'

import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@/domain/crm/lead-stage'
import { MINI_INQUIRY_STATUS_LABELS } from '@/domain/mini-program/inquiry-status'

/**
 * OPT-117：小程序「我的 › 咨询记录」给客户看的状态文案。
 *
 * 此前接口直接复用 CRM 的 LEAD_STAGE_LABELS，客户会看到自己的咨询被标成
 * 「待分配」「有效商机」「已流失」。这里守两件事：每个线索阶段都有面向客户的文案，
 * 且文案里不出现销售侧术语。CRM 后台仍用 LEAD_STAGE_LABELS，不受影响。
 */

describe('MINI_INQUIRY_STATUS_LABELS', () => {
  it('覆盖全部线索阶段', () => {
    expect(Object.keys(MINI_INQUIRY_STATUS_LABELS).sort()).toEqual([...LEAD_STAGES].sort())
  })

  it('面向客户的映射', () => {
    expect(MINI_INQUIRY_STATUS_LABELS).toEqual({
      new: '已提交',
      pending_assignment: '已提交',
      following: '顾问跟进中',
      qualified: '顾问跟进中',
      viewing: '已安排看房',
      negotiation: '洽谈中',
      converted: '已完成',
      lost: '已结束',
    })
  })

  it.each(LEAD_STAGES)('%s 的客户文案不是 CRM 内部名称', (stage) => {
    expect(MINI_INQUIRY_STATUS_LABELS[stage]).not.toBe(LEAD_STAGE_LABELS[stage])
    expect(MINI_INQUIRY_STATUS_LABELS[stage]).not.toMatch(/待分配|有效商机|已流失|已转化|带看|谈判|新建|线索|商机/)
  })
})
