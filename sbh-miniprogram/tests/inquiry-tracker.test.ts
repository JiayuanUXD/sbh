import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearInquiryRecordsForTesting,
  getPendingInquiryCount,
  getRecentInquiries,
  recordInquiry,
} from '../miniprogram/services/inquiry-tracker.js'

describe('留资跟进记录服务 (Inquiry Tracker Service)', () => {
  beforeEach(() => {
    clearInquiryRecordsForTesting()
  })

  it('初始状态下无留资记录且待跟进数为 0', () => {
    expect(getRecentInquiries()).toHaveLength(0)
    expect(getPendingInquiryCount()).toBe(0)
  })

  it('提交留资成功后正确归档并更新待跟进计数', () => {
    recordInquiry({
      submissionRequestId: 'req_001',
      targetType: 'listing',
      targetSlug: 'wheelock-square-12f',
      targetTitle: '越洋国际广场 · 12 层整层',
      status: 'pending',
      statusLabel: '待带看',
    })

    const records = getRecentInquiries()
    expect(records).toHaveLength(1)
    expect(records[0]?.targetTitle).toBe('越洋国际广场 · 12 层整层')
    expect(records[0]?.statusLabel).toBe('待带看')
    expect(getPendingInquiryCount()).toBe(1)
  })

  it('重复同一 submissionRequestId 幂等处理不重复计数', () => {
    recordInquiry({
      submissionRequestId: 'req_dup',
      targetType: 'listing',
      targetTitle: '恒隆广场整层',
      status: 'pending',
      statusLabel: '进行中',
    })
    recordInquiry({
      submissionRequestId: 'req_dup',
      targetType: 'listing',
      targetTitle: '恒隆广场整层',
      status: 'pending',
      statusLabel: '进行中',
    })

    expect(getRecentInquiries()).toHaveLength(1)
    expect(getPendingInquiryCount()).toBe(1)
  })

  it('多条记录按提交时间倒序排列并限制最大保留数', () => {
    for (let i = 1; i <= 5; i++) {
      recordInquiry({
        submissionRequestId: `req_${i}`,
        targetType: 'listing',
        targetTitle: `房源 ${i}`,
        status: i % 2 === 0 ? 'contacted' : 'pending',
        statusLabel: i % 2 === 0 ? '顾问已联系' : '待带看',
      })
    }

    const records = getRecentInquiries()
    expect(records).toHaveLength(5)
    expect(records[0]?.submissionRequestId).toBe('req_5')
    expect(getPendingInquiryCount()).toBe(3) // req_1, req_3, req_5
  })
})
