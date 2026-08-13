/**
 * 单测：domain/supply-submission 纯函数
 *
 * 守护不变量：
 *   - 输入视为 unknown，白名单收窄后才落库；
 *   - 必填：buildingName / address / areaSqm / contactPhone / consent.accepted=true
 *     / consent.policyVersion / source.path / requestId；
 *   - 选填：rentAmount / rentUnit / commissionMonths（缺省 none）；
 *   - 流程字段（status/assignee/matchedBuilding...）即使传入也必须被丢弃；
 *   - source.path 只接受同源 pathname，query/hash 被剥离，绝对 URL 被拒；
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；
 *   - 安全日志不含手机号原文、楼盘名、地址、原始 IP。
 */

import { describe, expect, it } from 'vitest'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import {
  COMMISSION_MONTHS,
  SUPPLY_LIMITS,
  validateSupplySubmission,
} from '@/domain/supply-submission/schema'
import { computeSupplyIdempotencyKeySync } from '@/domain/supply-submission/idempotency'
import { buildSupplyLogEntry, hashIpForLog } from '@/domain/supply-submission/privacy-log'

/** 最小合法请求体 */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-0001',
    buildingName: '静安嘉里中心',
    address: '3 号楼 12 层 1203 室',
    areaSqm: 260,
    contactPhone: '13800001111',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { path: '/publish' },
    ...overrides,
  }
}

describe('validateSupplySubmission - city attribution', () => {
  it('preserves a canonical public city slug for server-side resolution', () => {
    const r = validateSupplySubmission(validBody({ city: 'hangzhou' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.city).toBe('hangzhou')
  })

  it.each([' HangZhou ', 'publish', 'unknown/path', 42, null])(
    'rejects an explicit noncanonical or reserved city: %s',
    (city) => {
      const r = validateSupplySubmission(validBody({ city }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors).toContain('city_invalid')
    },
  )
})

describe('validateSupplySubmission - 成功路径', () => {
  it('最小合法请求体通过，佣金缺省为 none', () => {
    const r = validateSupplySubmission(validBody())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.buildingName).toBe('静安嘉里中心')
    expect(r.data.areaSqm).toBe(260)
    expect(r.data.commissionMonths).toBe('none')
    expect(r.data.phoneNormalized).toBe('13800001111')
    expect(r.data.rentAmount).toBeNull()
    expect(r.data.rentUnit).toBeNull()
  })

  it('接受租金与单位，并保留佣金枚举', () => {
    const r = validateSupplySubmission(
      validBody({ rentAmount: 8.5, rentUnit: 'rmb-sqm-day', commissionMonths: '1.5' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.rentAmount).toBe(8.5)
    expect(r.data.rentUnit).toBe('rmb-sqm-day')
    expect(r.data.commissionMonths).toBe('1.5')
  })

  it('剥离 source.path 的 query 与 hash', () => {
    const r = validateSupplySubmission(
      validBody({ source: { path: '/publish?utm_source=wechat#form' } }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source.path).toBe('/publish')
  })

  it('丢弃外部传入的流程字段', () => {
    const r = validateSupplySubmission(
      validBody({ status: 'converted', assignee: 1, matchedBuilding: 9, reviewNote: 'x' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data as Record<string, unknown>).not.toHaveProperty('status')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('assignee')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('matchedBuilding')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('reviewNote')
  })

  it('全部佣金枚举值都被接受', () => {
    for (const value of COMMISSION_MONTHS) {
      const r = validateSupplySubmission(validBody({ commissionMonths: value }))
      expect(r.ok).toBe(true)
    }
  })
})

describe('validateSupplySubmission - 失败路径', () => {
  it('非对象输入返回 invalid_body', () => {
    expect(validateSupplySubmission(null)).toEqual({ ok: false, errors: ['invalid_body'] })
    expect(validateSupplySubmission('x')).toEqual({ ok: false, errors: ['invalid_body'] })
    expect(validateSupplySubmission([])).toEqual({ ok: false, errors: ['invalid_body'] })
  })

  it('缺楼盘名 / 地址 / 面积 / 手机号各自报错', () => {
    const r = validateSupplySubmission({
      requestId: 'req-1',
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: '/publish' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('building_name_required')
    expect(r.errors).toContain('address_required')
    expect(r.errors).toContain('area_required')
    expect(r.errors).toContain('phone_invalid')
  })

  it('手机号非中国大陆 11 位被拒', () => {
    const r = validateSupplySubmission(validBody({ contactPhone: '12345' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('phone_invalid')
  })

  it('面积非正数或超上限被拒', () => {
    for (const bad of [0, -1, SUPPLY_LIMITS.AREA_MAX + 1]) {
      const r = validateSupplySubmission(validBody({ areaSqm: bad }))
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors).toContain('area_invalid')
    }
  })

  it('楼盘名 / 地址超长被拒', () => {
    const r = validateSupplySubmission(
      validBody({
        buildingName: 'A'.repeat(SUPPLY_LIMITS.BUILDING_NAME_MAX + 1),
        address: 'B'.repeat(SUPPLY_LIMITS.ADDRESS_MAX + 1),
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('building_name_too_long')
    expect(r.errors).toContain('address_too_long')
  })

  it('未同意隐私政策或版本不匹配被拒', () => {
    const notAccepted = validateSupplySubmission(
      validBody({ consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION } }),
    )
    expect(notAccepted.ok).toBe(false)
    if (!notAccepted.ok) expect(notAccepted.errors).toContain('consent_required')

    const wrongVersion = validateSupplySubmission(
      validBody({ consent: { accepted: true, policyVersion: 'BOGUS' } }),
    )
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.errors).toContain('consent_version_mismatch')
  })

  it('佣金非枚举值被拒', () => {
    const r = validateSupplySubmission(validBody({ commissionMonths: '3' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('commission_invalid')
  })

  it('租金单位非枚举、租金为负被拒', () => {
    const unit = validateSupplySubmission(validBody({ rentAmount: 5, rentUnit: 'usd-month' }))
    expect(unit.ok).toBe(false)
    if (!unit.ok) expect(unit.errors).toContain('rent_unit_invalid')

    const amount = validateSupplySubmission(validBody({ rentAmount: -3, rentUnit: 'rmb-month' }))
    expect(amount.ok).toBe(false)
    if (!amount.ok) expect(amount.errors).toContain('rent_amount_invalid')
  })

  it('绝对 URL / 协议相对 URL / 非同源路径作为 source.path 被拒', () => {
    for (const bad of ['https://evil.com/publish', '//evil.com/publish', 'publish']) {
      const r = validateSupplySubmission(validBody({ source: { path: bad } }))
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors).toContain('source_path_invalid')
    }
  })

  it('source.path 含控制字符被拒', () => {
    for (const bad of ['/publish\x00', '/pub\x1flish', '/publish\x7f']) {
      const r = validateSupplySubmission(validBody({ source: { path: bad } }))
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors).toContain('source_path_invalid')
    }
  })
})

describe('computeSupplyIdempotencyKeySync', () => {
  it('同输入同键，64 位 hex', () => {
    const a = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心', '3 号楼 1203')
    const b = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心', '3 号楼 1203')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('楼盘名或手机号不同则键不同', () => {
    const base = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心', '3 号楼 1203')
    expect(
      computeSupplyIdempotencyKeySync('req-1', '13800001111', '恒隆广场', '3 号楼 1203'),
    ).not.toBe(base)
    expect(
      computeSupplyIdempotencyKeySync('req-1', '13900002222', '静安嘉里中心', '3 号楼 1203'),
    ).not.toBe(base)
  })

  /**
   * 同一业主在同一楼盘有多套在租房源是商办常态。地址若不参与幂等键，第二套会被
   * 判为重放、服务端返回 ok 但不落库，线索静默丢失（审查发现）。
   */
  it('同人同楼盘但地址不同则键不同', () => {
    const unitA = computeSupplyIdempotencyKeySync(
      'req-1',
      '13800001111',
      '静安嘉里中心',
      '3 号楼 12 层 1203 室',
    )
    const unitB = computeSupplyIdempotencyKeySync(
      'req-1',
      '13800001111',
      '静安嘉里中心',
      '3 号楼 15 层 1505 室',
    )
    expect(unitB).not.toBe(unitA)
  })
})

describe('buildSupplyLogEntry', () => {
  it('不含手机号原文、楼盘名、地址', () => {
    const r = validateSupplySubmission(validBody({ rentAmount: 8, rentUnit: 'rmb-sqm-day' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const entry = buildSupplyLogEntry(r.data, {
      idempotent: false,
      errorCode: null,
      durationMs: 12,
    })
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('13800001111')
    expect(serialized).not.toContain('静安嘉里中心')
    expect(serialized).not.toContain('1203')
    expect(entry.hasRent).toBe(true)
    expect(entry.commissionMonths).toBe('none')
    expect(entry.durationMs).toBe(12)
  })
})

describe('hashIpForLog', () => {
  it('同盐同 IP 稳定，换盐即变，返回 32 位 hex', () => {
    const a = hashIpForLog('1.2.3.4', '2026-08-09')
    expect(a).toBe(hashIpForLog('1.2.3.4', '2026-08-09'))
    expect(a).not.toBe(hashIpForLog('1.2.3.4', '2026-08-10'))
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })
})
