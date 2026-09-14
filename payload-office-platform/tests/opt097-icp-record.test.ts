import { describe, expect, it } from 'vitest'

import { ICP_RECORD_URL, isValidIcpRecordNumber, normalizeIcpRecordNumber } from '@/lib/frontend/icp-record'

/**
 * OPT-097：页脚 ICP 备案号。后台字段校验与前台映射共用 normalizeIcpRecordNumber，
 * 这里锁的是它的口径：三种常见形态放行，明显不是备案号的串拒绝。
 */
describe('normalizeIcpRecordNumber', () => {
  it('三种常见形态放行，首尾空白去掉', () => {
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号')).toBe('沪ICP备2026037944号')
    expect(normalizeIcpRecordNumber('京ICP证030173号')).toBe('京ICP证030173号')
    expect(normalizeIcpRecordNumber('粤ICP备12345678号-1')).toBe('粤ICP备12345678号-1')
    expect(normalizeIcpRecordNumber('  沪ICP备2026037944号  ')).toBe('沪ICP备2026037944号')
  })

  it('空串 / null / undefined / 非字符串 → null', () => {
    expect(normalizeIcpRecordNumber('')).toBeNull()
    expect(normalizeIcpRecordNumber('   ')).toBeNull()
    expect(normalizeIcpRecordNumber(null)).toBeNull()
    expect(normalizeIcpRecordNumber(undefined)).toBeNull()
    expect(normalizeIcpRecordNumber(2026037944)).toBeNull()
  })

  it('缺省份 / 缺「号」/ 中间带空格 / 纯数字 / 英文 → null', () => {
    expect(normalizeIcpRecordNumber('ICP备2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备 2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('abc')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号-abc')).toBeNull()
  })
})

describe('isValidIcpRecordNumber（后台字段 validate）', () => {
  it('留空合法', () => {
    expect(isValidIcpRecordNumber(undefined)).toBe(true)
    expect(isValidIcpRecordNumber(null)).toBe(true)
    expect(isValidIcpRecordNumber('')).toBe(true)
    expect(isValidIcpRecordNumber('  ')).toBe(true)
  })

  it('填了就必须能归一化', () => {
    expect(isValidIcpRecordNumber('沪ICP备2026037944号')).toBe(true)
    expect(isValidIcpRecordNumber('abc')).toBe(false)
  })
})

it('备案链接固定指向工信部备案系统', () => {
  expect(ICP_RECORD_URL).toBe('https://beian.miit.gov.cn/')
})
