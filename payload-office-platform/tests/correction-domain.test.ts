/**
 * P1 Task 6 单测：domain/corrections 模块纯函数
 *
 * 守护不变量：
 *   - 请求体视为 unknown，schema 白名单收窄后才落库
 *   - 类别仅 7 类公开枚举（price/area/availability/media/location/building-fact/other）
 *   - targetType 仅 listing/building
 *   - description 必填且 ≤500 字
 *   - 幂等键 = sha256(requestId | targetType | targetSlug | category)，不含 PII
 *   - 安全日志不含 description 正文、不含原始 IP（FPD-P1 §7 隐私）
 */

import { describe, expect, it } from 'vitest'
import {
  computeCorrectionIdempotencyKeySync,
} from '@/domain/corrections/idempotency'
import {
  buildCorrectionLogEntry,
} from '@/domain/corrections/privacy-log'
import {
  CORRECTION_CATEGORIES,
  CORRECTION_TARGET_TYPES,
  validateCorrection,
  type CorrectionRequest,
} from '@/domain/corrections/schema'

// ---------------------------------------------------------------------------
// 公共 fixture
// ---------------------------------------------------------------------------

const VALID_REQUEST_ID = 'req-correction-0123-4567-89ab-cdef01234567'
const VALID_TARGET_SLUG = 'jingan-center-100-monthly'

/** 构造合法的完整请求对象（unknown 输入），允许局部覆盖 */
function buildValidInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    requestId: VALID_REQUEST_ID,
    targetType: 'listing',
    targetSlug: VALID_TARGET_SLUG,
    category: 'price',
    description: '价格疑似有误',
    ...overrides,
  }
}

/** 校验通过后取出 data（测试辅助） */
function validData(input: unknown): CorrectionRequest {
  const result = validateCorrection(input)
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join(',')}`)
  return result.data
}

// ---------------------------------------------------------------------------
// 类别白名单
// ---------------------------------------------------------------------------

describe('validateCorrection / 类别白名单', () => {
  it('只允许公开纠错类别', () => {
    for (const category of CORRECTION_CATEGORIES) {
      expect(validateCorrection(buildValidInput({ category })).ok).toBe(true)
    }
  })

  it('拒绝非白名单类别', () => {
    expect(validateCorrection(buildValidInput({ category: 'phone' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ category: 'price2' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ category: '' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ category: null })).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// targetType 白名单
// ---------------------------------------------------------------------------

describe('validateCorrection / targetType 白名单', () => {
  it('接受 listing 与 building', () => {
    expect(validateCorrection(buildValidInput({ targetType: 'listing' })).ok).toBe(true)
    expect(validateCorrection(buildValidInput({ targetType: 'building' })).ok).toBe(true)
  })

  it('拒绝非白名单 targetType', () => {
    expect(validateCorrection(buildValidInput({ targetType: 'none' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ targetType: 'agent' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ targetType: '' })).ok).toBe(false)
  })

  it('CORRECTION_TARGET_TYPES 仅 listing/building', () => {
    expect([...CORRECTION_TARGET_TYPES]).toEqual(['listing', 'building'])
  })
})

// ---------------------------------------------------------------------------
// 必填与长度
// ---------------------------------------------------------------------------

describe('validateCorrection / 必填与长度', () => {
  it('description 必填且 ≤500', () => {
    expect(validateCorrection(buildValidInput({ description: '' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ description: '   ' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ description: 'a'.repeat(500) })).ok).toBe(true)
    expect(validateCorrection(buildValidInput({ description: 'a'.repeat(501) })).ok).toBe(false)
  })

  it('requestId 必填', () => {
    expect(validateCorrection(buildValidInput({ requestId: '' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ requestId: '   ' })).ok).toBe(false)
  })

  it('targetSlug 必填', () => {
    expect(validateCorrection(buildValidInput({ targetSlug: '' })).ok).toBe(false)
    expect(validateCorrection(buildValidInput({ targetSlug: 'a' })).ok).toBe(true)
  })

  it('非对象输入拒绝', () => {
    expect(validateCorrection(null).ok).toBe(false)
    expect(validateCorrection('string').ok).toBe(false)
    expect(validateCorrection(undefined).ok).toBe(false)
    expect(validateCorrection([]).ok).toBe(false)
  })

  it('字符串两端空白被 trim', () => {
    const data = validData(buildValidInput({ description: '  价格有误  ' }))
    expect(data.description).toBe('价格有误')
  })
})

// ---------------------------------------------------------------------------
// 幂等键
// ---------------------------------------------------------------------------

describe('computeCorrectionIdempotencyKeySync', () => {
  it('同输入 -> 同键', () => {
    const a = computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'listing', 'slug-a', 'price')
    const b = computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'listing', 'slug-a', 'price')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('任一输入变化 -> 不同键', () => {
    const base = computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'listing', 'slug-a', 'price')
    expect(computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'listing', 'slug-a', 'area')).not.toBe(base)
    expect(computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'listing', 'slug-b', 'price')).not.toBe(base)
    expect(computeCorrectionIdempotencyKeySync(VALID_REQUEST_ID, 'building', 'slug-a', 'price')).not.toBe(base)
    expect(computeCorrectionIdempotencyKeySync('other-req', 'listing', 'slug-a', 'price')).not.toBe(base)
  })
})

// ---------------------------------------------------------------------------
// 隐私日志
// ---------------------------------------------------------------------------

describe('buildCorrectionLogEntry / 隐私', () => {
  it('不含 description 正文', () => {
    const data = validData(buildValidInput({ description: '价格疑似有误，联系电话 13800001111' }))
    const entry = buildCorrectionLogEntry(data, {
      idempotent: false,
      errorCode: null,
      durationMs: 12,
    })
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('13800001111')
    expect(serialized).not.toContain('价格疑似有误')
    expect(entry.hasDescription).toBe(true)
  })

  it('记录类别枚举与目标，但不记正文', () => {
    const data = validData(buildValidInput({ category: 'area', targetType: 'building', targetSlug: 'west-tower' }))
    const entry = buildCorrectionLogEntry(data, {
      idempotent: true,
      errorCode: null,
      durationMs: 5,
    })
    expect(entry.category).toBe('area')
    expect(entry.targetType).toBe('building')
    expect(entry.targetSlug).toBe('west-tower')
    expect(entry.idempotent).toBe(true)
    expect(entry.errorCode).toBeNull()
    expect(entry.durationMs).toBe(5)
    // 不存在 description 字段
    expect((entry as unknown as Record<string, unknown>).description).toBeUndefined()
  })
})
