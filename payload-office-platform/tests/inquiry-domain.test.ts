/**
 * F5 单测：domain/inquiry 模块纯函数
 *
 * 设计依据：specs/frontend-mvp/tasks/F5-inquiry.md 5.3–5.6、
 *           specs/frontend-mvp/design.md §10、§12.2、§13、
 *           Page PRD FP-05 §5、§8、§9
 *
 * 守护不变量：
 *   - 请求体视为 unknown，schema 白名单收窄后才落库（FP-05 §5）
 *   - 字段长度、枚举、手机号、consent、source、campaign 全面校验
 *   - 幂等键 = sha256(requestId | normalizedPhone | targetType | targetSlug)
 *     同输入 → 同键；任一输入变化 → 不同键
 *   - 活动归因仅允许 5 个 UTM 键 + 长度限制 + 非字符串拒绝
 *   - 安全日志不含完整姓名/手机号/留言/原始 URL（FP-05 §8）
 *   - IP 哈希不可逆推
 */

import { describe, expect, it } from 'vitest'
import {
  computeIdempotencyKeySync,
  deriveTargetSlug,
} from '@/domain/inquiry/idempotency'
import {
  buildInquiryLogEntry,
  deriveFieldCompleteness,
  FIELD_COMPLETENESS,
  hashIpForLog,
  sanitizeUrlForLog,
} from '@/domain/inquiry/privacy-log'
import { sanitizeCampaign, CAMPAIGN_KEYS } from '@/domain/inquiry/campaign'
import { fillEntrustLeadName } from '@/domain/inquiry/entrust-name-fallback'
import {
  LIMITS,
  MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT,
  SOURCE_SECTIONS,
  SOURCE_PAGE_TYPES,
  TARGET_TYPES,
  validateInquiry,
  type InquiryRequest,
} from '@/domain/inquiry/schema'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

// ---------------------------------------------------------------------------
// 公共 fixture
// ---------------------------------------------------------------------------

const VALID_PHONE = '13800001111'
const VALID_REQUEST_ID = 'req-uuid-0123-4567-89ab-cdef01234567'
const VALID_LISTING_SLUG = 'jingan-center-100-monthly'
const VALID_BUILDING_SLUG = 'jingan-center'
const VALID_PATH = '/listings/jingan-center-100-monthly'

/** 构造合法的完整请求对象（unknown 输入），允许局部覆盖 */
function buildValidInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    requestId: VALID_REQUEST_ID,
    name: '测试用户',
    phone: VALID_PHONE,
    company: '测试公司',
    message: '想约看这套房源',
    listingSlug: VALID_LISTING_SLUG,
    demand: {
      district: '静安',
      budget: '1-2 万元/月',
      area: '100-200 ㎡',
      moveInTime: '2026 年 9 月',
    },
    consent: {
      accepted: true,
      policyVersion: PRIVACY_POLICY_VERSION,
    },
    source: {
      pageType: 'listing',
      path: VALID_PATH,
      campaign: {
        utm_source: 'baidu',
        utm_medium: 'cpc',
        utm_campaign: 'mvp-launch',
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// validateInquiry: 合法输入
// ---------------------------------------------------------------------------

describe('validateInquiry: 合法输入', () => {
  it('只接受白名单 section 和供给筛选', () => {
    const r = validateInquiry(
      buildValidInput({
        source: {
          pageType: 'building',
          path: '/buildings/bund-soho',
          section: 'supply-lease',
          currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
        },
        activeSupplyGroup: 'lease',
        priceSnapshot: {
          amount: 8.5,
          currency: 'CNY',
          period: 'day',
          unit: 'rmb-sqm-day',
        },
      }),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source.section).toBe('supply-lease')
    expect(r.data.source.currentFilters).toEqual({ group: 'lease', priceUnit: 'rmb-sqm-day' })
    expect(r.data.activeSupplyGroup).toBe('lease')
    expect(r.data.priceSnapshot).toEqual({
      amount: 8.5,
      currency: 'CNY',
      period: 'day',
      unit: 'rmb-sqm-day',
    })
    expect(SOURCE_SECTIONS).toContain('supply-lease')
  })

  it('拒绝未白名单的详情上下文且不保留原值', () => {
    const r = validateInquiry(
      buildValidInput({
        source: {
          pageType: 'building',
          path: '/buildings/bund-soho',
          section: 'notes=李四13800001111',
          currentFilters: { group: 'lease', keyword: '李四' },
        },
        activeSupplyGroup: 'unknown',
        priceSnapshot: {
          amount: 8.5,
          currency: 'USD',
          period: 'day',
          unit: 'rmb-sqm-day',
        },
      }),
    )

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(expect.arrayContaining([
      'source_section_invalid',
      'source_filters_invalid',
      'active_supply_group_invalid',
      'price_snapshot_invalid',
    ]))
    expect(JSON.stringify(r)).not.toContain('李四')
    expect(JSON.stringify(r)).not.toContain('13800001111')
  })

  it('价格快照金额只接受正数且不超过明确上限', () => {
    const atBoundary = validateInquiry(buildValidInput({
      priceSnapshot: {
        amount: MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT,
        currency: 'CNY',
        period: 'day',
        unit: 'rmb-sqm-day',
      },
    }))
    expect(atBoundary.ok).toBe(true)

    for (const amount of [0, -1, MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT + 1, Number.MAX_VALUE]) {
      const r = validateInquiry(buildValidInput({
        priceSnapshot: { amount, currency: 'CNY', period: 'day', unit: 'rmb-sqm-day' },
      }))
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errors).toContain('price_snapshot_invalid')
        expect(JSON.stringify(r)).not.toContain(String(amount))
      }
    }
  })

  it('source 只接受精确浅层白名单且不回显嵌套 PII 形状数据', () => {
    const injectedPii = '李四13900009999'
    const r = validateInquiry(buildValidInput({
      source: {
        pageType: 'listing',
        path: VALID_PATH,
        campaign: {},
        injected: { profile: { contact: injectedPii } },
      },
    }))

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('source_invalid')
    expect(JSON.stringify(r)).not.toContain(injectedPii)
  })

  it('source.path 只保留同源 pathname，剥离 query/hash 中的手机号', () => {
    const injectedPhone = '13900009999'
    const r = validateInquiry(buildValidInput({
      source: {
        pageType: 'listing',
        path: `${VALID_PATH}?phone=${injectedPhone}#contact=${injectedPhone}`,
        campaign: {},
      },
    }))

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source.path).toBe(VALID_PATH)
    expect(JSON.stringify(r.data)).not.toContain(injectedPhone)
  })

  it.each([
    'https://evil.example/listings/x',
    '//evil.example/listings/x',
    '/listings/x\nX-Injected: yes',
    '/listings/x%0d%0aX-Injected',
  ])('source.path 拒绝绝对/协议相对 URL 与控制字符：%s', (path) => {
    const r = validateInquiry(buildValidInput({
      source: { pageType: 'listing', path, campaign: {} },
    }))

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('source_path_invalid')
  })

  it('完整合法输入 → ok=true，字段全部映射', () => {
    const r = validateInquiry(buildValidInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const data = r.data
    expect(data.requestId).toBe(VALID_REQUEST_ID)
    expect(data.name).toBe('测试用户')
    expect(data.phone).toBe(VALID_PHONE)
    expect(data.phoneNormalized).toBe(VALID_PHONE)
    expect(data.company).toBe('测试公司')
    expect(data.message).toBe('想约看这套房源')
    expect(data.listingSlug).toBe(VALID_LISTING_SLUG)
    expect(data.buildingSlug).toBeNull()
    expect(data.targetType).toBe('listing')
    expect(data.consent.accepted).toBe(true)
    expect(data.consent.policyVersion).toBe(PRIVACY_POLICY_VERSION)
    expect(data.source.pageType).toBe('listing')
    expect(data.source.path).toBe(VALID_PATH)
    expect(data.source.campaign.utm_source).toBe('baidu')
    expect(data.source.campaign.utm_medium).toBe('cpc')
    expect(data.source.campaign.utm_campaign).toBe('mvp-launch')
    expect(data.source.campaign.utm_content).toBe('')
    expect(data.source.campaign.utm_term).toBe('')
    expect(data.demand.district).toBe('静安')
    expect(data.demand.budget).toBe('1-2 万元/月')
    expect(data.demand.area).toBe('100-200 ㎡')
    expect(data.demand.moveInTime).toBe('2026 年 9 月')
  })

  it('building 入口（buildingSlug 而非 listingSlug）→ targetType=building', () => {
    const r = validateInquiry(
      buildValidInput({
        listingSlug: undefined,
        buildingSlug: VALID_BUILDING_SLUG,
        source: { pageType: 'building', path: `/buildings/${VALID_BUILDING_SLUG}` },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.targetType).toBe('building')
      expect(r.data.buildingSlug).toBe(VALID_BUILDING_SLUG)
      expect(r.data.listingSlug).toBeNull()
    }
  })

  it('home 通用需求入口（无 listing/building slug）→ targetType=none', () => {
    const r = validateInquiry(
      buildValidInput({
        listingSlug: undefined,
        source: { pageType: 'home', path: '/' },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.targetType).toBe('none')
      expect(r.data.listingSlug).toBeNull()
      expect(r.data.buildingSlug).toBeNull()
    }
  })

  it('message / company / demand 选填可缺', () => {
    const r = validateInquiry(
      buildValidInput({
        company: undefined,
        message: undefined,
        demand: undefined,
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.company).toBeNull()
      expect(r.data.message).toBeNull()
      expect(r.data.demand.district).toBeNull()
      expect(r.data.demand.budget).toBeNull()
      expect(r.data.demand.area).toBeNull()
      expect(r.data.demand.moveInTime).toBeNull()
    }
  })

  it('前后空格被 trim（name/phone/company/message/slug/path）', () => {
    const r = validateInquiry(
      buildValidInput({
        name: '  张三  ',
        phone: '  138 0000 1111  ',
        company: '  测试公司  ',
        message: '  想约看  ',
        listingSlug: `  ${VALID_LISTING_SLUG}  `,
        source: { pageType: 'listing', path: `  ${VALID_PATH}  ` },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.name).toBe('张三')
      // 规范化后剥离空格
      expect(r.data.phone).toBe(VALID_PHONE)
      expect(r.data.company).toBe('测试公司')
      expect(r.data.message).toBe('想约看')
      expect(r.data.listingSlug).toBe(VALID_LISTING_SLUG)
      expect(r.data.source.path).toBe(VALID_PATH)
    }
  })

  it('campaign 缺失 → 空 attribution 合法', () => {
    const r = validateInquiry(
      buildValidInput({
        source: { pageType: 'listing', path: VALID_PATH },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.source.campaign.utm_source).toBe('')
      expect(r.data.source.campaign.utm_medium).toBe('')
    }
  })

  it('name=50 字符 / message=1000 字符 / path=500 字符 边界值', () => {
    const r = validateInquiry(
      buildValidInput({
        name: '测'.repeat(LIMITS.NAME_MAX),
        message: '测'.repeat(LIMITS.MESSAGE_MAX),
        source: {
          pageType: 'listing',
          path: `/${'a'.repeat(LIMITS.PATH_MAX - 1)}`,
        },
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('requestId=100 字符 边界值', () => {
    const r = validateInquiry(
      buildValidInput({
        requestId: 'r'.repeat(LIMITS.REQUEST_ID_MAX),
      }),
    )
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateInquiry: 必填字段缺失
// ---------------------------------------------------------------------------

describe('validateInquiry: 必填缺失', () => {
  it('非对象输入 → invalid_body', () => {
    expect(validateInquiry(null).ok).toBe(false)
    expect(validateInquiry(undefined).ok).toBe(false)
    expect(validateInquiry('string').ok).toBe(false)
    expect(validateInquiry(123).ok).toBe(false)
    expect(validateInquiry([]).ok).toBe(false)
  })

  it('name 缺失 / 空字符串 → name_required', () => {
    const r1 = validateInquiry(buildValidInput({ name: undefined }))
    const r2 = validateInquiry(buildValidInput({ name: '   ' }))
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (!r1.ok) expect(r1.errors).toContain('name_required')
    if (!r2.ok) expect(r2.errors).toContain('name_required')
  })

  it('phone 缺失 / 非中国大陆手机号 → phone_invalid', () => {
    const cases = [undefined, '', '12345', '23000001111', '12345678901', 'abcd']
    for (const phone of cases) {
      const r = validateInquiry(buildValidInput({ phone }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors).toContain('phone_invalid')
    }
  })

  it('requestId 缺失 / 空字符串 → request_id_required', () => {
    const r = validateInquiry(buildValidInput({ requestId: undefined }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('request_id_required')
  })

  it('consent 缺失 / accepted 非 true → consent_required', () => {
    const r1 = validateInquiry(buildValidInput({ consent: undefined }))
    const r2 = validateInquiry(
      buildValidInput({ consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION } }),
    )
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (!r1.ok) expect(r1.errors).toContain('consent_required')
    if (!r2.ok) expect(r2.errors).toContain('consent_required')
  })

  it('consent.policyVersion 不匹配 → consent_version_invalid', () => {
    const r = validateInquiry(
      buildValidInput({
        consent: { accepted: true, policyVersion: 'OLD-v0' },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('consent_version_invalid')
  })

  it('source 缺失 → source_required + source_path_required', () => {
    const r = validateInquiry(buildValidInput({ source: undefined }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('source_required')
      expect(r.errors).toContain('source_path_required')
    }
  })

  it('source.pageType 非枚举 → source_page_type_invalid', () => {
    const r = validateInquiry(
      buildValidInput({
        source: { pageType: 'unknown', path: VALID_PATH },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('source_page_type_invalid')
  })

  it('source.path 缺失 / 空字符串 → source_path_required', () => {
    const r1 = validateInquiry(
      buildValidInput({ source: { pageType: 'listing' } }),
    )
    const r2 = validateInquiry(
      buildValidInput({ source: { pageType: 'listing', path: '   ' } }),
    )
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (!r1.ok) expect(r1.errors).toContain('source_path_required')
    if (!r2.ok) expect(r2.errors).toContain('source_path_required')
  })
})

// ---------------------------------------------------------------------------
// validateInquiry: 长度边界
// ---------------------------------------------------------------------------

describe('validateInquiry: 长度超限', () => {
  it('name 超长 → name_too_long', () => {
    const r = validateInquiry(
      buildValidInput({ name: '测'.repeat(LIMITS.NAME_MAX + 1) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('name_too_long')
  })

  it('company 超长 → company_too_long', () => {
    const r = validateInquiry(
      buildValidInput({ company: '测'.repeat(LIMITS.COMPANY_MAX + 1) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('company_too_long')
  })

  it('message 超长 → message_too_long', () => {
    const r = validateInquiry(
      buildValidInput({ message: '测'.repeat(LIMITS.MESSAGE_MAX + 1) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('message_too_long')
  })

  it('path 超长 → source_path_too_long', () => {
    const r = validateInquiry(
      buildValidInput({
        source: { pageType: 'listing', path: '/'.repeat(LIMITS.PATH_MAX + 1) },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('source_path_too_long')
  })

  it('requestId 超长 → request_id_too_long', () => {
    const r = validateInquiry(
      buildValidInput({ requestId: 'r'.repeat(LIMITS.REQUEST_ID_MAX + 1) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('request_id_too_long')
  })

  it('campaign 值超长 → campaign_invalid', () => {
    const r = validateInquiry(
      buildValidInput({
        source: {
          pageType: 'listing',
          path: VALID_PATH,
          campaign: { utm_source: 'a'.repeat(LIMITS.CAMPAIGN_VALUE_MAX + 1) },
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('campaign_invalid')
  })

  it('campaign 值为非字符串 → campaign_invalid', () => {
    const r = validateInquiry(
      buildValidInput({
        source: {
          pageType: 'listing',
          path: VALID_PATH,
          campaign: { utm_source: 123 },
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('campaign_invalid')
  })
})

// ---------------------------------------------------------------------------
// validateInquiry: 枚举完整性
// ---------------------------------------------------------------------------

describe('validateInquiry: 枚举', () => {
  it('SOURCE_PAGE_TYPES 与 INQUIRY_SOURCE_PAGE_TYPES 对齐', () => {
    expect(SOURCE_PAGE_TYPES).toEqual(['home', 'search', 'listing', 'building', 'content', 'entrust'])
  })

  it('TARGET_TYPES 与 INQUIRY_TARGET_TYPES 对齐', () => {
    expect(TARGET_TYPES).toEqual(['listing', 'building', 'none'])
  })

  it('每个 SOURCE_PAGE_TYPES 值都被接受', () => {
    for (const pageType of SOURCE_PAGE_TYPES) {
      const r = validateInquiry(
        buildValidInput({
          listingSlug: undefined,
          source: { pageType, path: '/test' },
        }),
      )
      expect(r.ok).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// sanitizeCampaign
// ---------------------------------------------------------------------------

describe('sanitizeCampaign', () => {
  it('null / undefined → 空 attribution（合法）', () => {
    expect(sanitizeCampaign(null).ok).toBe(true)
    expect(sanitizeCampaign(undefined).ok).toBe(true)
  })

  it('空对象 → 空 attribution', () => {
    const r = sanitizeCampaign({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      for (const key of CAMPAIGN_KEYS) {
        expect(r.data[key]).toBe('')
      }
    }
  })

  it('仅白名单 5 个 UTM 键被接受', () => {
    const r = sanitizeCampaign({
      utm_source: 'baidu',
      utm_medium: 'cpc',
      utm_campaign: 'mvp',
      utm_content: 'ad-1',
      utm_term: 'office',
      // 非白名单键被忽略
      utm_id: 'should-be-ignored',
      ref: 'should-be-ignored',
      foo: { nested: 'object' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.utm_source).toBe('baidu')
      expect(r.data.utm_medium).toBe('cpc')
      expect(r.data.utm_campaign).toBe('mvp')
      expect(r.data.utm_content).toBe('ad-1')
      expect(r.data.utm_term).toBe('office')
    }
  })

  it('非字符串值 → 拒绝（null/undefined 被当作缺失忽略，符合空 attribution 语义）', () => {
    expect(sanitizeCampaign({ utm_source: 123 }).ok).toBe(false)
    expect(sanitizeCampaign({ utm_source: { foo: 1 } }).ok).toBe(false)
    expect(sanitizeCampaign({ utm_source: ['array'] }).ok).toBe(false)
    // null / undefined 被当作缺失，不影响合法性
    expect(sanitizeCampaign({ utm_source: null }).ok).toBe(true)
    expect(sanitizeCampaign({ utm_source: undefined }).ok).toBe(true)
  })

  it('值超 100 字符 → 拒绝', () => {
    const r = sanitizeCampaign({ utm_source: 'a'.repeat(101) })
    expect(r.ok).toBe(false)
  })

  it('值 = 100 字符（边界）合法', () => {
    const r = sanitizeCampaign({ utm_source: 'a'.repeat(100) })
    expect(r.ok).toBe(true)
  })

  it('值前后空格被 trim', () => {
    const r = sanitizeCampaign({ utm_source: '  baidu  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.utm_source).toBe('baidu')
  })

  it('非对象输入（数组、字符串、数字）→ 拒绝', () => {
    expect(sanitizeCampaign([]).ok).toBe(false)
    expect(sanitizeCampaign('foo').ok).toBe(false)
    expect(sanitizeCampaign(123).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeIdempotencyKeySync + deriveTargetSlug
// ---------------------------------------------------------------------------

describe('computeIdempotencyKeySync', () => {
  it('同输入 → 同键（幂等不变量）', () => {
    const k1 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    const k2 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    expect(k1).toBe(k2)
  })

  it('返回 64 字符 hex', () => {
    const k = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })

  it('不同 requestId → 不同键', () => {
    const k1 = computeIdempotencyKeySync('req-a', VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    const k2 = computeIdempotencyKeySync('req-b', VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    expect(k1).not.toBe(k2)
  })

  it('不同手机号 → 不同键', () => {
    const k1 = computeIdempotencyKeySync(VALID_REQUEST_ID, '13800001111', 'listing', VALID_LISTING_SLUG)
    const k2 = computeIdempotencyKeySync(VALID_REQUEST_ID, '13800002222', 'listing', VALID_LISTING_SLUG)
    expect(k1).not.toBe(k2)
  })

  it('不同 targetType → 不同键', () => {
    const k1 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', VALID_LISTING_SLUG)
    const k2 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'building', VALID_LISTING_SLUG)
    expect(k1).not.toBe(k2)
  })

  it('不同 targetSlug → 不同键', () => {
    const k1 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', 'slug-a')
    const k2 = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'listing', 'slug-b')
    expect(k1).not.toBe(k2)
  })

  it('targetType=none 时空 slug 也能计算（通用需求幂等）', () => {
    const k = computeIdempotencyKeySync(VALID_REQUEST_ID, VALID_PHONE, 'none', '')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('deriveTargetSlug', () => {
  it('targetType=listing → 返回 listingSlug', () => {
    expect(deriveTargetSlug('listing', 'slug-a', null)).toBe('slug-a')
  })

  it('targetType=building → 返回 buildingSlug', () => {
    expect(deriveTargetSlug('building', null, 'slug-b')).toBe('slug-b')
  })

  it('targetType=none → 返回空字符串', () => {
    expect(deriveTargetSlug('none', 'any', 'any')).toBe('')
  })

  it('listing 但 listingSlug 缺失 → 返回空字符串（安全回退）', () => {
    expect(deriveTargetSlug('listing', null, null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// privacy-log: buildInquiryLogEntry + deriveFieldCompleteness
// ---------------------------------------------------------------------------

describe('deriveFieldCompleteness', () => {
  function req(opts: {
    company?: string | null
    message?: string | null
    district?: string | null
    budget?: string | null
    area?: string | null
    moveInTime?: string | null
  }): InquiryRequest {
    return {
      requestId: VALID_REQUEST_ID,
      name: 'test',
      phone: VALID_PHONE,
      phoneNormalized: VALID_PHONE,
      company: opts.company ?? null,
      message: opts.message ?? null,
      listingSlug: VALID_LISTING_SLUG,
      buildingSlug: null,
      targetType: 'listing',
      demand: {
        district: opts.district ?? null,
        budget: opts.budget ?? null,
        area: opts.area ?? null,
        moveInTime: opts.moveInTime ?? null,
      },
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { pageType: 'listing', path: '/test', section: null, currentFilters: null, campaign: {
        utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
      } },
      priceSnapshot: null,
      activeSupplyGroup: null,
      viewingPreference: null,
    }
  }

  it('仅必填 → REQUIRED_ONLY', () => {
    expect(deriveFieldCompleteness(req({}))).toBe(FIELD_COMPLETENESS.REQUIRED_ONLY)
  })

  it('必填 + 公司 → WITH_COMPANY', () => {
    expect(deriveFieldCompleteness(req({ company: 'c' }))).toBe(FIELD_COMPLETENESS.WITH_COMPANY)
  })

  it('必填 + 留言 → WITH_MESSAGE', () => {
    expect(deriveFieldCompleteness(req({ message: 'm' }))).toBe(FIELD_COMPLETENESS.WITH_MESSAGE)
  })

  it('必填 + 公司 + 留言 → WITH_COMPANY_AND_MESSAGE', () => {
    expect(deriveFieldCompleteness(req({ company: 'c', message: 'm' }))).toBe(
      FIELD_COMPLETENESS.WITH_COMPANY_AND_MESSAGE,
    )
  })

  it('含任意需求字段 → WITH_DEMAND（优先级高于公司/留言）', () => {
    expect(deriveFieldCompleteness(req({ district: '静安' }))).toBe(FIELD_COMPLETENESS.WITH_DEMAND)
    expect(deriveFieldCompleteness(req({ budget: '1 万' }))).toBe(FIELD_COMPLETENESS.WITH_DEMAND)
    expect(deriveFieldCompleteness(req({ area: '100㎡' }))).toBe(FIELD_COMPLETENESS.WITH_DEMAND)
    expect(deriveFieldCompleteness(req({ moveInTime: '9 月' }))).toBe(FIELD_COMPLETENESS.WITH_DEMAND)
  })

  it('全字段 → FULL', () => {
    expect(
      deriveFieldCompleteness(req({ company: 'c', message: 'm', district: 'd' })),
    ).toBe(FIELD_COMPLETENESS.FULL)
  })
})

describe('buildInquiryLogEntry', () => {
  function validReq(overrides: Partial<InquiryRequest> = {}): InquiryRequest {
    return {
      requestId: VALID_REQUEST_ID,
      name: '张三',
      phone: VALID_PHONE,
      phoneNormalized: VALID_PHONE,
      company: '测试公司',
      message: '团队规模：10-20 人\n想约看',
      listingSlug: VALID_LISTING_SLUG,
      buildingSlug: null,
      targetType: 'listing',
      demand: { district: '静安', budget: null, area: null, moveInTime: null },
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: {
        pageType: 'listing',
        path: VALID_PATH,
        section: null,
        currentFilters: null,
        campaign: {
          utm_source: 'baidu',
          utm_medium: 'cpc',
          utm_campaign: 'mvp',
          utm_content: '',
          utm_term: '',
        },
      },
      priceSnapshot: null,
      activeSupplyGroup: null,
      viewingPreference: null,
      ...overrides,
    }
  }

  it('不含完整姓名、完整手机号、留言正文', () => {
    const entry = buildInquiryLogEntry(validReq(), {
      idempotent: false,
      errorCode: null,
      durationMs: 42,
    })
    const json = JSON.stringify(entry)
    expect(json).not.toContain('张三')
    expect(json).not.toContain(VALID_PHONE)
    expect(json).not.toContain('想约看')
    expect(json).not.toContain('团队规模：10-20 人')
    expect(json).not.toContain('测试公司')
  })

  it('包含脱敏手机号（138****1111 格式）', () => {
    const entry = buildInquiryLogEntry(validReq(), {
      idempotent: false,
      errorCode: null,
      durationMs: 42,
    })
    expect(entry.phoneMasked).toMatch(/^\d{3}\*+\d{4}$/)
    expect(entry.phoneMasked).not.toBe(VALID_PHONE)
  })

  it('包含 requestId / pageType / path / targetType / targetSlug', () => {
    const entry = buildInquiryLogEntry(validReq(), {
      idempotent: false,
      errorCode: null,
      durationMs: 42,
    })
    expect(entry.requestId).toBe(VALID_REQUEST_ID)
    expect(entry.pageType).toBe('listing')
    expect(entry.path).toBe(VALID_PATH)
    expect(entry.targetType).toBe('listing')
    expect(entry.targetSlug).toBe(VALID_LISTING_SLUG)
  })

  it('纵深清洗手工构造请求中的 query/hash PII 后再写日志', () => {
    const injectedPhone = '13900009999'
    const entry = buildInquiryLogEntry(
      validReq({
        source: {
          ...validReq().source,
          path: `${VALID_PATH}?phone=${injectedPhone}#contact=${injectedPhone}`,
        },
      }),
      { idempotent: false, errorCode: null, durationMs: 1 },
    )

    expect(entry.path).toBe(VALID_PATH)
    expect(JSON.stringify(entry)).not.toContain(injectedPhone)
  })

  it('campaignKeys 仅记录存在的键，不含值', () => {
    const entry = buildInquiryLogEntry(validReq(), {
      idempotent: false,
      errorCode: null,
      durationMs: 42,
    })
    expect(entry.campaignKeys).toEqual(['utm_source', 'utm_medium', 'utm_campaign'])
    // 不含值
    expect(JSON.stringify(entry)).not.toContain('baidu')
    expect(JSON.stringify(entry)).not.toContain('cpc')
  })

  it('building 入口 targetSlug=buildingSlug', () => {
    const entry = buildInquiryLogEntry(
      validReq({
        listingSlug: null,
        buildingSlug: VALID_BUILDING_SLUG,
        targetType: 'building',
      }),
      { idempotent: false, errorCode: null, durationMs: 1 },
    )
    expect(entry.targetSlug).toBe(VALID_BUILDING_SLUG)
  })

  it('none 入口 targetSlug=null', () => {
    const entry = buildInquiryLogEntry(
      validReq({
        listingSlug: null,
        buildingSlug: null,
        targetType: 'none',
      }),
      { idempotent: false, errorCode: null, durationMs: 1 },
    )
    expect(entry.targetSlug).toBeNull()
  })

  it('记录 idempotent / errorCode / durationMs / fieldCompleteness', () => {
    // validReq 含 company + message + demand.district → FULL
    const entry = buildInquiryLogEntry(validReq(), {
      idempotent: true,
      errorCode: 'listing_not_found',
      durationMs: 999,
    })
    expect(entry.idempotent).toBe(true)
    expect(entry.errorCode).toBe('listing_not_found')
    expect(entry.durationMs).toBe(999)
    expect(entry.fieldCompleteness).toBe(FIELD_COMPLETENESS.FULL)
  })
})

// ---------------------------------------------------------------------------
// privacy-log: sanitizeUrlForLog + hashIpForLog
// ---------------------------------------------------------------------------

describe('sanitizeUrlForLog', () => {
  it('合法 URL 仅保留 path（剥离 query 中的潜在个人信息）', () => {
    expect(sanitizeUrlForLog('https://example.com/listings/x?phone=13800001111')).toBe('/listings/x')
    expect(sanitizeUrlForLog('https://example.com/?utm_content=secret')).toBe('/')
  })

  it('相对路径用占位 origin 解析', () => {
    expect(sanitizeUrlForLog('/listings/x')).toBe('/listings/x')
    expect(sanitizeUrlForLog('/')).toBe('/')
  })

  it('非法 URL → [invalid-url]（不泄露原值）', () => {
    // Node URL 构造函数对许多输入宽松，仅当真正抛错时才返回 [invalid-url]
    expect(sanitizeUrlForLog('http://[invalid')).toBe('[invalid-url]')
  })
})

describe('hashIpForLog', () => {
  it('同 IP + 同盐 → 同哈希（可重放验证）', () => {
    const salt = '2026-07-26'
    const h1 = hashIpForLog('1.2.3.4', salt)
    const h2 = hashIpForLog('1.2.3.4', salt)
    expect(h1).toBe(h2)
  })

  it('不同 IP → 不同哈希', () => {
    const salt = 'salt'
    expect(hashIpForLog('1.2.3.4', salt)).not.toBe(hashIpForLog('5.6.7.8', salt))
  })

  it('同 IP 不同盐 → 不同哈希（轮换盐防长期关联）', () => {
    expect(hashIpForLog('1.2.3.4', 'day-1')).not.toBe(hashIpForLog('1.2.3.4', 'day-2'))
  })

  it('返回 32 字符 hex（截断防暴力反推）', () => {
    const h = hashIpForLog('1.2.3.4', 'salt')
    expect(h).toMatch(/^[0-9a-f]{32}$/)
  })

  it('哈希结果不含原始 IP 字符串（hex 仅 0-9a-f，但完整 IP 字符串不出现）', () => {
    const h = hashIpForLog('1.2.3.4', 'salt')
    // 单个数字 1-4 必然出现在 hex 中，但完整点分 IP 字符串不应出现
    expect(h).not.toContain('1.2.3.4')
    expect(h).not.toContain('1.')
    expect(h).not.toContain('.4')
  })
})

// ---------------------------------------------------------------------------
// 委托找房落地页（PRD §4.3 / §4.4）
// ---------------------------------------------------------------------------

describe('validateInquiry - entrust 渠道', () => {
  /** 委托找房首屏只采集手机号，没有姓名字段。 */
  const entrustBody = {
    phone: '13800001111',
    requestId: 'entrust-1',
    targetType: 'none',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { pageType: 'entrust', path: '/entrust' },
  }

  it('缺姓名也通过，name 归一化为字符串', () => {
    const r = validateInquiry(entrustBody)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.name).toBe('')
    expect(r.data.source.pageType).toBe('entrust')
    expect(r.data.targetType).toBe('none')
  })

  it('其他渠道缺姓名仍报 name_required', () => {
    const r = validateInquiry({
      ...entrustBody,
      source: { pageType: 'home', path: '/' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('name_required')
  })

  it('entrust 渠道手机号非法仍被拒绝', () => {
    const r = validateInquiry({ ...entrustBody, phone: '123' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('phone_invalid')
  })

  it('entrust 渠道未同意隐私政策仍被拒绝', () => {
    const r = validateInquiry({
      ...entrustBody,
      consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION },
    })
    expect(r.ok).toBe(false)
  })
})

describe('fillEntrustLeadName', () => {
  it('entrust 渠道且无姓名时填入兜底姓名（含手机号后四位）', async () => {
    const data = await fillEntrustLeadName({
      data: { phone: '13800001111', sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('未留姓名（1111）')
  })

  it('已有姓名时不覆盖', async () => {
    const data = await fillEntrustLeadName({
      data: { name: '张先生', phone: '13800001111', sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('张先生')
  })

  it('非 entrust 渠道不填兜底姓名', async () => {
    const data = await fillEntrustLeadName({
      data: { phone: '13800001111', sourcePageType: 'listing' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name?: string }).name).toBeUndefined()
  })

  it('手机号缺失时用固定兜底文案，不抛异常', async () => {
    const data = await fillEntrustLeadName({
      data: { sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('未留姓名')
  })
})
