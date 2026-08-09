import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENTS,
  assertSafeAnalyticsProps,
  serializeProps,
  validateEvent,
} from '@/lib/frontend/analytics/events'

describe('OPT-010 events validateEvent', () => {
  it('已知事件 + 白名单内属性 -> 通过并保留', () => {
    const r = validateEvent('inquiry_open', {
      page_type: 'listing',
      target_type: 'listing',
      has_target: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.eventName).toBe('inquiry_open')
      expect(r.sanitized).toEqual({
        page_type: 'listing',
        target_type: 'listing',
        has_target: true,
      })
    }
  })

  it('未知事件名 -> 丢弃', () => {
    const r = validateEvent('inquiry_bogus', { page_type: 'listing' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('unknown_event')
  })

  it('白名单外属性 -> 剥离（防 PII 泄漏）', () => {
    // name/message 不在任何事件白名单，必须被剥离
    const r = validateEvent('inquiry_submit', {
      page_type: 'listing',
      target_type: 'listing',
      field_completeness: { name: true }, // 对象值，非法
      name: '张三', // 白名单外
      phone: '13800000000', // 白名单外 PII
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sanitized).not.toHaveProperty('name')
      expect(r.sanitized).not.toHaveProperty('phone')
      expect(r.sanitized).not.toHaveProperty('field_completeness')
    }
  })

  it('对象/数组值 -> 丢弃该 key（防嵌套注入）', () => {
    const r = validateEvent('inquiry_error', {
      page_type: 'listing',
      error_code: 'rate_limited',
      extra: { nested: 'x' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sanitized.error_code).toBe('rate_limited')
      expect(r.sanitized).not.toHaveProperty('extra')
    }
  })

  it('字符串值超长 -> 截断到 100 字符', () => {
    const longCode = 'x'.repeat(200)
    const r = validateEvent('inquiry_error', { page_type: 'listing', error_code: longCode })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(String(r.sanitized.error_code).length).toBe(100)
    }
  })

  it('null/undefined 属性值 -> 跳过（不写入）', () => {
    const r = validateEvent('inquiry_open', {
      page_type: 'listing',
      target_type: null,
      has_target: undefined,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sanitized).toEqual({ page_type: 'listing' })
    }
  })

  it('number 值保留', () => {
    // field_completeness 在 inquiry_submit 白名单，但语义上是对象；
    // 这里验证 number 类型能通过
    const r = validateEvent('inquiry_submit', {
      page_type: 'listing',
      target_type: 'listing',
      field_completeness: 5,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sanitized.field_completeness).toBe(5)
  })
})

describe('OPT-010 events serializeProps', () => {
  it('同属性不同顺序 -> 相同指纹（去重稳定）', () => {
    const a = serializeProps({ page_type: 'listing', target_type: 'listing' })
    const b = serializeProps({ target_type: 'listing', page_type: 'listing' })
    expect(a).toBe(b)
  })

  it('不同属性 -> 不同指纹', () => {
    const a = serializeProps({ page_type: 'listing' })
    const b = serializeProps({ page_type: 'building' })
    expect(a).not.toBe(b)
  })
})

describe('OPT-010 events ANALYTICS_EVENTS 白名单完整性', () => {
  it('所有事件属性 key 均为枚举/上下文标记，不含自由文本字段', () => {
    // 隐私保证：白名单内不应出现 name/phone/email/message/ip 等敏感 key
    const sensitive = ['name', 'phone', 'email', 'message', 'ip', 'userId', 'ip_address']
    for (const [eventName, keys] of Object.entries(ANALYTICS_EVENTS)) {
      for (const k of keys) {
        expect(sensitive, `${eventName}.${k} 不应是敏感字段`).not.toContain(k)
      }
    }
  })
})

describe('detail page analytics privacy contract', () => {
  it('分析属性拒绝 PII key', () => {
    expect(() => assertSafeAnalyticsProps({ phone: '13800001111' })).toThrow()
    expect(() => assertSafeAnalyticsProps({ phoneNumber: '13800001111' })).toThrow()
    expect(() => assertSafeAnalyticsProps({ note: '请联系我' })).toThrow()
  })

  it('详情事件只接受匿名 ID、枚举、计数、排名、section、asOf 和完整度', () => {
    const result = validateEvent('recommendation_click', {
      listing_id: 101,
      target_listing_id: 102,
      recommendation_type: 'same_building',
      rank: 1,
      section: 'related',
      title: '不应保留',
      phone: '13800001111',
    })

    expect(result).toMatchObject({
      ok: true,
      sanitized: {
        listing_id: 101,
        target_listing_id: 102,
        recommendation_type: 'same_building',
        rank: 1,
        section: 'related',
      },
    })
  })
})

describe('landing conversion analytics privacy contract', () => {
  it('registers the six funnel events with only aggregate and enumerated properties', () => {
    expect(ANALYTICS_EVENTS).toMatchObject({
      landing_view: ['page_type'],
      landing_form_start: ['page_type'],
      landing_form_submit: ['page_type', 'field_completeness', 'commission_months'],
      landing_form_success: ['page_type'],
      landing_form_error: ['page_type', 'error_code'],
      landing_bottom_cta_click: ['page_type'],
    })

    const result = validateEvent('landing_form_submit', {
      page_type: 'publish',
      field_completeness: 6,
      commission_months: '1',
      phone: '13800001111',
      name: 'private building',
      address: 'private address',
      path: '/publish?phone=13800001111',
    })

    expect(result).toEqual({
      ok: true,
      eventName: 'landing_form_submit',
      sanitized: {
        page_type: 'publish',
        field_completeness: 6,
        commission_months: '1',
      },
    })
  })

  it('rejects every prohibited landing-event property key before collection', () => {
    for (const key of ['phone', 'name', 'address', 'path', 'url']) {
      expect(() => assertSafeAnalyticsProps({ [key]: 'private' })).toThrow(
        `unsafe analytics property: ${key}`,
      )
    }
  })
})
