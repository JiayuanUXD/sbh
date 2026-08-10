import { describe, expect, it } from 'vitest'
import { validateDemandUpdate, LIMITS } from '@/domain/inquiry'

describe('validateDemandUpdate', () => {
  it('accepts a valid request with one field and normalizes the phone', () => {
    const result = validateDemandUpdate({
      requestId: 'entrust-abc',
      phone: '138 0000 1111',
      demand: { budget: '3万/月' },
    })
    expect(result).toEqual({
      ok: true,
      data: {
        requestId: 'entrust-abc',
        phone: '13800001111',
        phoneNormalized: '13800001111',
        demand: { district: null, budget: '3万/月', area: null, moveInTime: null },
      },
    })
  })

  it('trims demand fields and nulls empties', () => {
    const result = validateDemandUpdate({
      requestId: 'r',
      phone: '13800001111',
      demand: { district: ' 浦东 ', area: '   ', budget: ' 200㎡ ', moveInTime: '' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.demand).toEqual({
        district: '浦东',
        area: null,
        budget: '200㎡',
        moveInTime: null,
      })
    }
  })

  it('rejects when no demand field is provided', () => {
    const result = validateDemandUpdate({
      requestId: 'r',
      phone: '13800001111',
      demand: { district: '   ', area: '', budget: '', moveInTime: '  ' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('demand_empty')
  })

  it('rejects an invalid phone', () => {
    const result = validateDemandUpdate({ requestId: 'r', phone: '123', demand: { budget: 'x' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('phone_invalid')
  })

  it('rejects a missing or too-long requestId', () => {
    const missing = validateDemandUpdate({ phone: '13800001111', demand: { budget: 'x' } })
    expect(missing.ok).toBe(false)

    const tooLong = validateDemandUpdate({
      requestId: 'x'.repeat(LIMITS.REQUEST_ID_MAX + 1),
      phone: '13800001111',
      demand: { budget: 'x' },
    })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.errors).toContain('request_id_too_long')
  })

  it('rejects a demand field exceeding the length cap', () => {
    const result = validateDemandUpdate({
      requestId: 'r',
      phone: '13800001111',
      demand: { budget: 'x'.repeat(LIMITS.DEMAND_FIELD_MAX + 1) },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('demand_invalid')
  })

  it('rejects a non-object body', () => {
    const result = validateDemandUpdate('not-an-object')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('invalid_body')
  })
})
