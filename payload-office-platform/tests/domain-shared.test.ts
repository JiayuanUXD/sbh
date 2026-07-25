import { describe, expect, it } from 'vitest'
import {
  DomainError,
  ForbiddenError,
  IllegalStateTransitionError,
  InvalidOperationError,
  NotFoundError,
  VersionConflictError,
} from '@/domain/shared/errors'
import { err, ok } from '@/domain/shared/result'
import {
  isWithinShanghaiDay,
  parseUtcIso,
  shanghaiDate,
  shanghaiDayEndUtc,
  shanghaiDayStartUtc,
  shanghaiDayKey,
  formatShanghai,
  toUtcIso,
} from '@/domain/shared/time'
import {
  isValidCnMobile,
  maskPhone,
  normalizePhone,
  phoneLast4,
} from '@/domain/shared/phone'
import {
  isValidMoney,
  isValidSqmArea,
  monthlyRentFromUnitPrice,
} from '@/domain/shared/money'
import {
  findOverlappingIndexes,
  isWithinValidity,
  isValidPeriod,
  periodsOverlap,
  type ValidityPeriod,
} from '@/domain/shared/validity'

describe('shared/errors', () => {
  it('DomainError 默认 isOperational=true', () => {
    const e = new DomainError({
      code: 'TEST',
      domain: 'auth',
      message: 'x',
    })
    expect(e.isOperational).toBe(true)
    expect(e.code).toBe('TEST')
    expect(e.domain).toBe('auth')
  })

  it('ForbiddenError HTTP 映射 403', () => {
    const e = new ForbiddenError({ domain: 'auth' })
    expect(e.code).toBe('FORBIDDEN')
    expect(e.isOperational).toBe(true)
  })

  it('NotFoundError 包含 resource 与 id', () => {
    const e = new NotFoundError({ domain: 'supply', resource: 'Listing', id: 42 })
    expect(e.details).toMatchObject({ resource: 'Listing', id: 42 })
  })

  it('InvalidOperationError 支持自定义 code', () => {
    const e = new InvalidOperationError({
      domain: 'crm',
      code: 'DAILY_CLAIM_LIMIT_EXCEEDED',
      message: '今日认领已满',
    })
    expect(e.code).toBe('DAILY_CLAIM_LIMIT_EXCEEDED')
  })

  it('VersionConflictError 暴露 expected/actual', () => {
    const e = new VersionConflictError({
      domain: 'supply',
      resource: 'Listing',
      expectedVersion: 3,
      actualVersion: 5,
    })
    expect(e.details).toMatchObject({ expectedVersion: 3, actualVersion: 5 })
  })

  it('IllegalStateTransitionError 列出允许的下一状态', () => {
    const e = new IllegalStateTransitionError({
      domain: 'crm',
      resource: 'Lead',
      from: 'new',
      to: 'converted',
      allowedTransitions: ['pending_assign', 'in_progress'],
    })
    expect(e.details).toMatchObject({
      from: 'new',
      to: 'converted',
      allowedTransitions: ['pending_assign', 'in_progress'],
    })
  })
})

describe('shared/result', () => {
  it('ok 携带 data', () => {
    const r = ok({ id: 1 })
    if (r.ok) {
      expect(r.data.id).toBe(1)
    }
  })

  it('err 携带 DomainError', () => {
    const e = new ForbiddenError({ domain: 'auth' })
    const r = err(e)
    if (!r.ok) {
      expect(r.error.code).toBe('FORBIDDEN')
    }
  })
})

describe('shared/time', () => {
  // 2026-03-15 18:30:00 Asia/Shanghai = 2026-03-15 10:30:00 UTC
  const utc = new Date('2026-03-15T10:30:00.000Z')

  it('toUtcIso 返回 ISO 字符串', () => {
    expect(toUtcIso(utc)).toBe('2026-03-15T10:30:00.000Z')
  })

  it('shanghaiDate 返回 YYYY-MM-DD（北京时间）', () => {
    expect(shanghaiDate(utc)).toBe('2026-03-15')
  })

  it('shanghaiDayKey 与 shanghaiDate 等价', () => {
    expect(shanghaiDayKey(utc)).toBe(shanghaiDate(utc))
  })

  it('shanghaiDayStartUtc 是当日 00:00 上海对应 UTC（前一日 16:00 UTC）', () => {
    expect(shanghaiDayStartUtc(utc).toISOString()).toBe('2026-03-14T16:00:00.000Z')
  })

  it('shanghaiDayEndUtc 是当日 23:59:59.999 上海对应 UTC', () => {
    expect(shanghaiDayEndUtc(utc).toISOString()).toBe('2026-03-15T15:59:59.999Z')
  })

  it('isWithinShanghaiDay 判断 UTC 时刻是否落在某自然日', () => {
    const day = utc
    expect(isWithinShanghaiDay(utc, day)).toBe(true)
    // 上海自然日外：早 8 小时
    const before = new Date('2026-03-15T15:59:59.000Z') // 2026-03-15 23:59:59 上海
    expect(isWithinShanghaiDay(before, day)).toBe(true)
    const after = new Date('2026-03-15T16:00:00.000Z') // 2026-03-16 00:00:00 上海
    expect(isWithinShanghaiDay(after, day)).toBe(false)
  })

  it('formatShanghai 输出 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatShanghai(utc)).toBe('2026-03-15 18:30:00')
  })

  it('parseUtcIso 非法返回 null', () => {
    expect(parseUtcIso('not-a-date')).toBeNull()
    expect(parseUtcIso('2026-03-15T10:30:00.000Z')?.getTime()).toBe(utc.getTime())
  })

  it('上海自然日跨 UTC 日界：UTC 2026-03-15 02:00 属上海 2026-03-15 10:00', () => {
    const crossDay = new Date('2026-03-15T02:00:00.000Z')
    expect(shanghaiDate(crossDay)).toBe('2026-03-15')
  })

  it('上海自然日跨 UTC 日界：UTC 2026-03-15 16:00 属上海 2026-03-16 00:00', () => {
    const nextDay = new Date('2026-03-15T16:00:00.000Z')
    expect(shanghaiDate(nextDay)).toBe('2026-03-16')
  })
})

describe('shared/phone', () => {
  it('normalizePhone 去除空格/横线/括号/+86 前缀', () => {
    expect(normalizePhone(' 138 0000 1111 ')).toBe('13800001111')
    expect(normalizePhone('138-0000-1111')).toBe('13800001111')
    expect(normalizePhone('(86) 13800001111')).toBe('13800001111')
    expect(normalizePhone('+8613800001111')).toBe('13800001111')
  })

  it('isValidCnMobile 拒绝非 1 开头 / 11 位 / 第二位非 3-9', () => {
    expect(isValidCnMobile('13800001111')).toBe(true)
    expect(isValidCnMobile('1380000111')).toBe(false) // 10 位
    expect(isValidCnMobile('12800001111')).toBe(false) // 第二位 2
    expect(isValidCnMobile('23000001111')).toBe(false) // 非 1 开头
  })

  it('maskPhone 输出 138****1111 格式', () => {
    expect(maskPhone('13800001111')).toBe('138****1111')
    expect(maskPhone('+86 138-0000-1111')).toBe('138****1111')
  })

  it('maskPhone 非法手机号原样返回', () => {
    expect(maskPhone('123')).toBe('123')
  })

  it('phoneLast4 返回尾 4 位', () => {
    expect(phoneLast4('13800001111')).toBe('1111')
    expect(phoneLast4('123')).toBe('123')
  })
})

describe('shared/money', () => {
  it('isValidMoney 拒负数 / 非数 / 超过 2 位小数', () => {
    expect(isValidMoney({ amount: 100, currency: 'CNY', period: 'month', unit: 'sqm' })).toBe(true)
    expect(isValidMoney({ amount: 100.5, currency: 'CNY', period: 'month', unit: 'sqm' })).toBe(true)
    expect(isValidMoney({ amount: 100.555, currency: 'CNY', period: 'month', unit: 'sqm' })).toBe(false)
    expect(isValidMoney({ amount: -1, currency: 'CNY', period: 'month', unit: 'sqm' })).toBe(false)
    expect(isValidMoney({ amount: Number.NaN, currency: 'CNY', period: 'month', unit: 'sqm' })).toBe(false)
  })

  it('isValidSqmArea 拒负数 / 超过 1 位小数', () => {
    expect(isValidSqmArea(100)).toBe(true)
    expect(isValidSqmArea(100.5)).toBe(true)
    expect(isValidSqmArea(100.55)).toBe(false)
    expect(isValidSqmArea(-1)).toBe(false)
  })

  it('monthlyRentFromUnitPrice = unitPrice × area，2 位小数', () => {
    expect(monthlyRentFromUnitPrice(8, 100)).toBe(800)
    expect(monthlyRentFromUnitPrice(8.5, 100.5)).toBe(854.25)
  })

  it('monthlyRentFromUnitPrice 非法面积返回 null', () => {
    expect(monthlyRentFromUnitPrice(8, -1)).toBeNull()
    expect(monthlyRentFromUnitPrice(8, 100.55)).toBeNull()
    expect(monthlyRentFromUnitPrice(-1, 100)).toBeNull()
  })
})

describe('shared/validity', () => {
  const p1: ValidityPeriod = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-02-01T00:00:00.000Z' }
  const p2: ValidityPeriod = { startsAt: '2026-01-15T00:00:00.000Z', endsAt: '2026-02-15T00:00:00.000Z' } // 与 p1 重叠
  const p3: ValidityPeriod = { startsAt: '2026-02-01T00:00:00.000Z', endsAt: '2026-03-01T00:00:00.000Z' } // 与 p1 在边界相接（不重叠）
  const p4: ValidityPeriod = { startsAt: '2026-02-01T00:00:00.000Z', endsAt: null } // 无限期

  it('isWithinValidity 边界 [start, end) 语义', () => {
    expect(isWithinValidity(new Date('2026-01-01T00:00:00.000Z'), p1)).toBe(true)
    expect(isWithinValidity(new Date('2026-01-31T23:59:59.999Z'), p1)).toBe(true)
    expect(isWithinValidity(new Date('2026-02-01T00:00:00.000Z'), p1)).toBe(false)
    expect(isWithinValidity(new Date('2025-12-31T23:59:59.999Z'), p1)).toBe(false)
  })

  it('isWithinValidity 无限期', () => {
    expect(isWithinValidity(new Date('2026-02-01T00:00:00.000Z'), p4)).toBe(true)
    expect(isWithinValidity(new Date('2099-01-01T00:00:00.000Z'), p4)).toBe(true)
  })

  it('periodsOverlap 边界相接不算重叠', () => {
    expect(periodsOverlap(p1, p2)).toBe(true)
    expect(periodsOverlap(p1, p3)).toBe(false) // p3 start = p1 end → 不重叠
    expect(periodsOverlap(p1, p4)).toBe(false) // p4 start = p1 end → 不重叠（[start, end) 半开）
    // 无限期与落在其内部的区间重叠
    expect(periodsOverlap(p4, p1)).toBe(false) // p4 start = p1 end → 不重叠
    const withinP4: ValidityPeriod = {
      startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-04-01T00:00:00.000Z',
    }
    expect(periodsOverlap(p4, withinP4)).toBe(true)
  })

  it('findOverlappingIndexes 返回重叠索引', () => {
    const existing = [p1, p3]
    // p2 = [Jan 15, Feb 15)：与 p1 [Jan 1, Feb 1) 重叠；与 p3 [Feb 1, Mar 1) 也重叠（p2 end = Feb 15 > p3 start = Feb 1）
    expect(findOverlappingIndexes(p2, existing)).toEqual([0, 1])
    // p3 与 p1 边界相接、与自身相同区间但在不同索引——p3 候选与 existing[0] 边界相接（不算）、与 existing[1] 完全相同（算重叠）
    expect(findOverlappingIndexes(p3, existing)).toEqual([1])
  })

  it('isValidPeriod 校验 start < end', () => {
    expect(isValidPeriod(p1)).toBe(true)
    expect(isValidPeriod({ startsAt: '2026-02-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:00.000Z' })).toBe(false)
    expect(isValidPeriod({ startsAt: '2026-02-01T00:00:00.000Z', endsAt: null })).toBe(true)
    expect(isValidPeriod({ startsAt: 'invalid', endsAt: null })).toBe(false)
  })
})
