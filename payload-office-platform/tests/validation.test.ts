import { describe, expect, it } from 'vitest'
import { validateInquiry } from '@/lib/frontend/validation'

const ok = { name: '张三', phone: '13800001111', listingSlug: 'jingan-center-360serviced', message: '想约看' }

describe('validateInquiry', () => {
  it('returns ok for valid payload', () => {
    const r = validateInquiry(ok)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('requires name', () => {
    const r = validateInquiry({ ...ok, name: '' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_required')
  })
  it('requires valid phone (11 digits CN mobile)', () => {
    expect(validateInquiry({ ...ok, phone: '123' }).ok).toBe(false)
    expect(validateInquiry({ ...ok, phone: '13800001111' }).ok).toBe(true)
  })
  it('rejects name > 50 chars', () => {
    expect(validateInquiry({ ...ok, name: 'x'.repeat(51) }).ok).toBe(false)
  })
  it('rejects message > 500 chars', () => {
    expect(validateInquiry({ ...ok, message: 'x'.repeat(501) }).ok).toBe(false)
  })
  it('rejects missing listingSlug', () => {
    expect(validateInquiry({ ...ok, listingSlug: '' }).ok).toBe(false)
  })
})
