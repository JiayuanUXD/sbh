/**
 * F0.4 单测：询盘 schema 验证
 *
 * 设计依据：FRONTEND_AGENT.md §10、§13；specs/frontend-mvp/design.md §10
 *
 * 守护不变量：
 *   - 服务端把请求体视为 unknown，通过 schema 收窄
 *   - 校验字段长度、枚举和手机号
 *   - 不接受未主动同意隐私政策的提交（待 M5 集成）
 *   - 错误返回稳定安全错误码，不泄露内部对象
 */

import { describe, expect, it } from 'vitest'
import { validateInquiry, type InquiryInput } from '@/lib/frontend/validation'
import {
  INQUIRY_INVALID_PHONES,
  INQUIRY_LONG_INPUTS,
  VALID_INQUIRY_INPUT,
} from '@/test/frontend/payload-documents'

// ---------------------------------------------------------------------------
// 合法输入
// ---------------------------------------------------------------------------

describe('validateInquiry: 合法输入', () => {
  it('完整合法输入 → ok=true', () => {
    const r = validateInquiry(VALID_INQUIRY_INPUT)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('message 为空仍然合法（非必填）', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, message: '' })
    expect(r.ok).toBe(true)
  })

  it('message 缺失仍然合法', () => {
    const r = validateInquiry({
      name: VALID_INQUIRY_INPUT.name,
      phone: VALID_INQUIRY_INPUT.phone,
      listingSlug: VALID_INQUIRY_INPUT.listingSlug,
    })
    expect(r.ok).toBe(true)
  })

  it('name 前后空格被 trim', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, name: '  张三  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.name).toBe('张三')
  })

  it('phone 前后空格被 trim', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, phone: '  13800001111  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.phone).toBe('13800001111')
  })

  it('listingSlug 前后空格被 trim', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      listingSlug: '  jingan-center-100-monthly  ',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.listingSlug).toBe('jingan-center-100-monthly')
  })

  it('message=500 字符仍合法（边界值）', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, message: '测'.repeat(500) })
    expect(r.ok).toBe(true)
  })

  it('name=50 字符仍合法（边界值）', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, name: '测'.repeat(50) })
    expect(r.ok).toBe(true)
  })

  it('不同 listingSlug 合法（含数字、连字符）', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      listingSlug: 'pudong-80-serviced-daily',
    })
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// name 字段校验
// ---------------------------------------------------------------------------

describe('validateInquiry: name 字段', () => {
  it('name 缺失 → name_required', () => {
    const r = validateInquiry({
      phone: VALID_INQUIRY_INPUT.phone,
      listingSlug: VALID_INQUIRY_INPUT.listingSlug,
    })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_required')
  })

  it('name=空字符串 → name_required', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, name: '' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_required')
  })

  it('name=仅空格 → name_required（trim 后为空）', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, name: '   ' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_required')
  })

  it('name=51 字符 → name_too_long', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, name: INQUIRY_LONG_INPUTS.name_51 })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_too_long')
  })
})

// ---------------------------------------------------------------------------
// phone 字段校验
// ---------------------------------------------------------------------------

describe('validateInquiry: phone 字段', () => {
  it('phone 缺失 → phone_invalid', () => {
    const r = validateInquiry({
      name: VALID_INQUIRY_INPUT.name,
      listingSlug: VALID_INQUIRY_INPUT.listingSlug,
    })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('phone_invalid')
  })

  it('各种非法手机号都被拒绝', () => {
    for (const phone of INQUIRY_INVALID_PHONES) {
      const r = validateInquiry({ ...VALID_INQUIRY_INPUT, phone })
      expect(r.ok).toBe(false)
      expect(r.errors).toContain('phone_invalid')
    }
  })

  it('合法手机号 138-9999-8888 通过', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, phone: '13899998888' })
    expect(r.ok).toBe(true)
  })

  it('合法手机号 1xx 开头（如 159）通过', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, phone: '15900001111' })
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// message 字段校验
// ---------------------------------------------------------------------------

describe('validateInquiry: message 字段', () => {
  it('message=501 字符 → message_too_long', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      message: INQUIRY_LONG_INPUTS.message_501,
    })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('message_too_long')
  })

  it('message 包含中文标点正常通过', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      message: '您好，请问这套房源还能看吗？谢谢！',
    })
    expect(r.ok).toBe(true)
  })

  it('message 包含换行符正常通过', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      message: '想约看\n时间：周末\n人数：3 人',
    })
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// listingSlug 字段校验
// ---------------------------------------------------------------------------

describe('validateInquiry: listingSlug 字段', () => {
  it('listingSlug 缺失 → listing_required', () => {
    const r = validateInquiry({
      name: VALID_INQUIRY_INPUT.name,
      phone: VALID_INQUIRY_INPUT.phone,
    })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('listing_required')
  })

  it('listingSlug=空字符串 → listing_required', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, listingSlug: '' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('listing_required')
  })

  it('listingSlug=仅空格 → listing_required', () => {
    const r = validateInquiry({ ...VALID_INQUIRY_INPUT, listingSlug: '   ' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('listing_required')
  })
})

// ---------------------------------------------------------------------------
// 多字段错误同时返回
// ---------------------------------------------------------------------------

describe('validateInquiry: 多字段错误', () => {
  it('所有字段都非法时返回多个错误码', () => {
    const r = validateInquiry({
      name: '',
      phone: '123',
      message: 'x'.repeat(501),
      listingSlug: '',
    })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('name_required')
    expect(r.errors).toContain('phone_invalid')
    expect(r.errors).toContain('message_too_long')
    expect(r.errors).toContain('listing_required')
    expect(r.errors.length).toBe(4)
  })

  it('错误返回的错误码集合稳定可枚举（不泄露内部对象）', () => {
    const r = validateInquiry({
      name: '',
      phone: '',
      message: '',
      listingSlug: '',
    })
    expect(r.ok).toBe(false)
    // 错误码必须是字符串数组
    if (!r.ok) {
      expect(Array.isArray(r.errors)).toBe(true)
      for (const e of r.errors) {
        expect(typeof e).toBe('string')
      }
    }
  })

  it('合法结果不暴露任何错误码', () => {
    const r = validateInquiry(VALID_INQUIRY_INPUT)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.errors).toEqual([])
      // 返回的 data 只包含白名单字段
      expect(Object.keys(r.data).sort()).toEqual(['listingSlug', 'message', 'name', 'phone'].sort())
    }
  })

  it('合法结果不返回额外字段（防止对象扩散）', () => {
    const r = validateInquiry({
      ...VALID_INQUIRY_INPUT,
      // 模拟前端额外字段（应被 schema 忽略，不出现在 data 中）
      extraField: 'should-be-ignored',
      internal_id: 'should-not-leak',
    } as InquiryInput & { extraField: string; internal_id: string })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toHaveProperty('extraField')
      expect(r.data).not.toHaveProperty('internal_id')
    }
  })
})
