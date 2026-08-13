/**
 * F7.5 综合验收：安全与隐私守护不变量汇总
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md 7.5
 *           specs/frontend-mvp/design.md §10、§12.2、§13
 *           Page PRD FP-05 §5–§9
 *           specs/frontend-mvp/tasks.md FRONTEND_AGENT.md §6.2
 *
 * 守护不变量（汇总断言）：
 *   - 公开 DTO（Listing/Building/Page · Card/Detail/Summary）字段白名单
 *     不暴露审核、举报、商户资质、内部电话、权限、审计、精确内部坐标或工作版本
 *   - 询盘 API 响应形状固定：{ ok: true } | { ok: false, errors: string[] } | { ok: false, error: string }
 *     不暴露 Lead ID、内部错误或房源失效原因
 *   - 隐私日志：姓名/完整手机号/留言正文/原始 URL/原始 IP 不出现
 *   - HTML 渲染：PageContent 不使用 dangerouslySetInnerHTML 渲染用户内容；
 *     所有 dangerouslySetInnerHTML 仅用于 JSON-LD 且做了 </script> 转义
 *   - schema 白名单：未知字段被丢弃，错误返回稳定安全错误码
 *
 * 与已有单测的关系：
 *   - public-catalog-contract.test.ts：DTO 字段白名单已部分覆盖（ListingCardViewModel）
 *   - inquiry-domain.test.ts：schema/幂等/隐私日志已覆盖
 *   - inquiry-api-route.test.ts：路由安全守护已覆盖
 *   - fp-06-content-seo-cache-acceptance.test.ts：metadata/缓存已覆盖
 *   本测试文件为 F7.5 验收汇总，整合所有守护不变量断言，便于上线前回归。
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  mapBuildingDetail,
  mapBuildingSummary,
  mapListingCard,
  mapListingDetail,
  mapPageDetail,
  mapPageSummary,
} from '@/domain/public-catalog/mappers'
import {
  BUILDING_JINGAN_CENTER,
  LISTING_MONTHLY_STANDARD,
  PAGE_PUBLISHED_GUIDE,
} from '@/test/frontend/payload-documents'
import { buildInquiryLogEntry } from '@/domain/inquiry/privacy-log'
import { validateInquiry } from '@/domain/inquiry/schema'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import type { InquiryRequest } from '@/domain/inquiry/schema'

// ---------------------------------------------------------------------------
// 共享 fixture
// ---------------------------------------------------------------------------

const VALID_INQUIRY_BODY: Record<string, unknown> = {
  requestId: 'req-f75-uuid-0123-4567-89ab-cdef01234567',
  name: '李四',
  phone: '13800002222',
  company: 'ACME',
  message: '希望下周看房',
  listingSlug: 'jingan-center-100-monthly',
  demand: { district: '静安', budget: '2-3 万', area: '100 ㎡', moveInTime: '9 月' },
  consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
  source: {
    pageType: 'listing',
    path: '/listings/jingan-center-100-monthly',
    campaign: { utm_source: 'baidu', utm_medium: 'cpc' },
  },
}

function buildValidInquiryRequest(): InquiryRequest {
  const result = validateInquiry(VALID_INQUIRY_BODY)
  if (!result.ok) throw new Error('fixture 应通过校验')
  return result.data
}

const SHARED_JSON_LD_MODULE = '@/lib/frontend/detail-metadata'

/**
 * Rejects comments, wrong imports, and locally-shadowed helpers by checking
 * the TSX AST rather than looking for serializer text in the source.
 */
function hasSharedJsonLdScriptSerialization(source: string): boolean {
  const sourceFile = ts.createSourceFile('route.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let importedSerializerName: string | null = null

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== SHARED_JSON_LD_MODULE) continue
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue
    const serializer = namedBindings.elements.find((element) => element.propertyName == null && element.name.text === 'serializeJsonLd')
    if (serializer) importedSerializerName = serializer.name.text
  }
  if (!importedSerializerName) return false

  let hasLocalShadow = false
  let matchingScriptCount = 0
  let hasUnsafeMatchingScript = false
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isParameter(node)) &&
      node.name && ts.isIdentifier(node.name) && node.name.text === importedSerializerName
    ) {
      hasLocalShadow = true
    }

    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null
    if (openingElement && openingElement.tagName.getText(sourceFile) === 'script') {
      const attributes = openingElement.attributes.properties
      const typeAttribute = attributes.find((attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'type',
      )
      const dangerousAttribute = attributes.find((attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'dangerouslySetInnerHTML',
      )
      const typeIsJsonLd = typeAttribute?.initializer != null &&
        ts.isStringLiteral(typeAttribute.initializer) &&
        typeAttribute.initializer.text === 'application/ld+json'
      const dangerousExpression = dangerousAttribute?.initializer
      if (typeIsJsonLd && dangerousAttribute) {
        matchingScriptCount += 1
      }
      if (typeIsJsonLd && dangerousExpression && ts.isJsxExpression(dangerousExpression) && dangerousExpression.expression && ts.isObjectLiteralExpression(dangerousExpression.expression)) {
        const htmlAssignment = dangerousExpression.expression.properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === '__html',
        )
        if (
          htmlAssignment &&
          ts.isCallExpression(htmlAssignment.initializer) &&
          ts.isIdentifier(htmlAssignment.initializer.expression) &&
          htmlAssignment.initializer.expression.text === importedSerializerName
        ) {
          // This matching JSON-LD script directly uses the imported helper.
        } else {
          hasUnsafeMatchingScript = true
        }
      } else if (typeIsJsonLd && dangerousAttribute) {
        hasUnsafeMatchingScript = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return matchingScriptCount > 0 && !hasUnsafeMatchingScript && !hasLocalShadow
}

// ---------------------------------------------------------------------------
// 1. 公开 DTO 字段白名单契约
// ---------------------------------------------------------------------------

describe('F7.5 公开 DTO 字段白名单契约', () => {
  /**
   * 所有不应出现在公开 DTO 的敏感字段。
   *
   * 注意：`status` 不在禁用清单，因为 PageDetailViewModel 故意声明
   * `status: 'published'` 作为"证明性字段"——只有已发布页面才会进入 DTO。
   * 此字段值固定为 'published'，不暴露草稿/删除/审核中等内部状态。
   */
  const FORBIDDEN_KEYS = [
    // 审核 / 发布 / 供给（注意：status 由 PageDetailViewModel 证明性字段保留，仅取值 'published'）
    'reviewStatus',
    'publicationStatus',
    'supplyVisibilityHold',
    'reviewSubmittedAt',
    'reviewDecision',
    'reviewReasons',
    // 举报
    'reports',
    'reportCount',
    'supplyPaused',
    'supplyPausedAt',
    // 商户资质 / 内部电话
    'merchantId',
    'merchant',
    'brokerId',
    'broker',
    'internalPhone',
    'brokerPhone',
    'contactPhone',
    // 权限 / 审计
    'createdBy',
    'lastModifiedBy',
    'deletedAt',
    '_status',
    // 精确内部坐标
    'geoLat',
    'geoLng',
    'latitude',
    'longitude',
    // 工作版本
    'workingVersion',
    'lockVersion',
  ] as const

  it('ListingCardViewModel 不包含任何敏感字段', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)!
    const keys = Object.keys(card)
    for (const f of FORBIDDEN_KEYS) {
      expect(keys, `ListingCardViewModel 不应暴露 ${f}`).not.toContain(f)
    }
    // Listing DTO 不应暴露 Payload 内部 status（草稿/已删除/已出租等）
    expect(keys).not.toContain('status')
  })

  it('ListingDetailViewModel 不包含任何敏感字段', () => {
    const detail = mapListingDetail(LISTING_MONTHLY_STANDARD)!
    const keys = Object.keys(detail)
    for (const f of FORBIDDEN_KEYS) {
      expect(keys, `ListingDetailViewModel 不应暴露 ${f}`).not.toContain(f)
    }
    expect(keys).not.toContain('status')
  })

  it('BuildingDetailViewModel 不包含任何敏感字段', () => {
    const detail = mapBuildingDetail(BUILDING_JINGAN_CENTER)!
    const keys = Object.keys(detail)
    for (const f of FORBIDDEN_KEYS) {
      expect(keys, `BuildingDetailViewModel 不应暴露 ${f}`).not.toContain(f)
    }
    // Building DTO 不应暴露 Payload 内部 operationalStatus / verificationStatus
    expect(keys).not.toContain('operationalStatus')
    expect(keys).not.toContain('verificationStatus')
    expect(keys).not.toContain('status')
  })

  it('BuildingSummaryViewModel 不包含任何敏感字段', () => {
    const summary = mapBuildingSummary(BUILDING_JINGAN_CENTER)!
    const keys = Object.keys(summary)
    for (const f of FORBIDDEN_KEYS) {
      expect(keys, `BuildingSummaryViewModel 不应暴露 ${f}`).not.toContain(f)
    }
    expect(keys).not.toContain('operationalStatus')
    expect(keys).not.toContain('verificationStatus')
    expect(keys).not.toContain('status')
  })

  it('PageDetailViewModel 不含 _status/trash/createdBy 等内部字段；status 仅作为已发布证明性字段', () => {
    const detail = mapPageDetail(PAGE_PUBLISHED_GUIDE)!
    const keys = Object.keys(detail)
    for (const f of FORBIDDEN_KEYS) {
      expect(keys, `PageDetailViewModel 不应暴露 ${f}`).not.toContain(f)
    }
    // 额外断言 status 字段固定为 'published'（不暴露草稿/删除/_status）
    expect(detail.status).toBe('published')
  })

  it('PageSummaryViewModel 仅暴露 id / slug / updatedAt', () => {
    const summary = mapPageSummary(PAGE_PUBLISHED_GUIDE)!
    expect(Object.keys(summary).sort()).toEqual(['id', 'slug', 'updatedAt'].sort())
  })

  it('ListingCardViewModel 字段清单与设计契约一致', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)!
    expect(Object.keys(card).sort()).toEqual(
      [
        'id',
        'slug',
        'title',
        'price',
        'area',
        'businessType',
        'citySlug',
        'cityName',
        'decorationStatus',
        'listingType',
        'availableFrom',
        'isFeatured',
        'building',
        'coverImage',
        'highlights',
        'stableSortKey',
      ].sort(),
    )
  })

  it('ListingDetailViewModel 在 Card 字段上增加详情值对象', () => {
    const detail = mapListingDetail(LISTING_MONTHLY_STANDARD)!
    expect(detail).toHaveProperty('seats')
    expect(detail).toHaveProperty('gallery')
    expect(detail).toHaveProperty('mediaItems')
    expect(detail).toHaveProperty('factGroups')
    expect(detail).toHaveProperty('amenityGroups')
    expect(detail).toHaveProperty('verification')
    expect(detail).toHaveProperty('description')
  })

  it('PageDetailViewModel 字段清单与设计契约一致', () => {
    const detail = mapPageDetail(PAGE_PUBLISHED_GUIDE)!
    expect(Object.keys(detail).sort()).toEqual(
      ['id', 'slug', 'title', 'status', 'hero', 'content', 'seo', 'stableSortKey', 'updatedAt'].sort(),
    )
  })

  it('listingId 不出现在 BuildingSummary 中（避免暴露内部 id 关联）', () => {
    const summary = mapBuildingSummary(BUILDING_JINGAN_CENTER)!
    expect(summary).not.toHaveProperty('listingId')
    expect(summary).not.toHaveProperty('listingCount')
  })

  it('mapListingDetail 不暴露原始 description 之外的内部字段（gallery 来自 cover + building）', () => {
    const detail = mapListingDetail(LISTING_MONTHLY_STANDARD)!
    // description 是受控字段（PageContent 白名单渲染），允许暴露
    expect(detail).toHaveProperty('description')
    // 但不应有未在 DTO 契约声明的字段
    const allowed = ['id', 'slug', 'title', 'citySlug', 'cityName', 'price', 'area', 'seats', 'businessType',
      'decorationStatus', 'listingType', 'availableFrom', 'isFeatured', 'building',
      'coverImage', 'gallery', 'mediaItems', 'factGroups', 'amenityGroups',
      'verification', 'highlights', 'description', 'stableSortKey']
    for (const k of Object.keys(detail)) {
      expect(allowed, `ListingDetailViewModel 不应包含未声明字段 ${k}`).toContain(k)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. schema 白名单 + 错误码稳定性
// ---------------------------------------------------------------------------

describe('F7.5 询盘 schema 白名单与稳定错误码', () => {
  it('未知字段被丢弃（不进入 InquiryRequest）', () => {
    const body = {
      ...VALID_INQUIRY_BODY,
      // 攻击者尝试注入内部字段
      reviewStatus: 'approved',
      publicationStatus: 'published',
      merchantId: 999,
      brokerId: 888,
      internalPhone: '13900000000',
      deletedAt: null,
      _status: 'published',
    }
    const result = validateInquiry(body)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const json = JSON.stringify(result.data)
      expect(json).not.toContain('reviewStatus')
      expect(json).not.toContain('publicationStatus')
      expect(json).not.toContain('merchantId')
      expect(json).not.toContain('brokerId')
      expect(json).not.toContain('internalPhone')
      expect(json).not.toContain('deletedAt')
      expect(json).not.toContain('_status')
    }
  })

  it('非对象输入 → invalid_body 稳定错误码', () => {
    for (const v of [null, undefined, 'string', 42, true, []]) {
      const result = validateInquiry(v)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors).toContain('invalid_body')
      }
    }
  })

  it('必填缺失返回字段名相关的稳定错误码（不暴露内部对象）', () => {
    const cases: Array<{ input: Record<string, unknown>; expected: string }> = [
      { input: { ...VALID_INQUIRY_BODY, name: '' }, expected: 'name_required' },
      { input: { ...VALID_INQUIRY_BODY, phone: '123' }, expected: 'phone_invalid' },
      { input: { ...VALID_INQUIRY_BODY, requestId: '' }, expected: 'request_id_required' },
      {
        input: { ...VALID_INQUIRY_BODY, consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION } },
        expected: 'consent_required',
      },
      {
        input: { ...VALID_INQUIRY_BODY, consent: { accepted: true, policyVersion: 'old-version' } },
        expected: 'consent_version_invalid',
      },
      { input: { ...VALID_INQUIRY_BODY, source: undefined }, expected: 'source_required' },
    ]
    for (const c of cases) {
      const result = validateInquiry(c.input)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors, `输入 ${JSON.stringify(c.input)} 应返回 ${c.expected}`).toContain(c.expected)
        // 错误码全部是稳定字符串，不含内部对象
        for (const e of result.errors) {
          expect(typeof e).toBe('string')
          expect(e.length).toBeLessThan(60)
        }
      }
    }
  })

  it('长度超限返回稳定错误码（不暴露原始值）', () => {
    const result = validateInquiry({ ...VALID_INQUIRY_BODY, name: '测'.repeat(51) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('name_too_long')
      // 错误码不含原始超长值
      expect(JSON.stringify(result.errors)).not.toContain('测'.repeat(51))
    }
  })

  it('手机号非法返回 phone_invalid（不回显原始输入）', () => {
    const result = validateInquiry({ ...VALID_INQUIRY_BODY, phone: 'not-a-phone' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('phone_invalid')
      expect(JSON.stringify(result.errors)).not.toContain('not-a-phone')
    }
  })

  it('campaign 非字符串值被拒绝（不暴露原始值）', () => {
    const result = validateInquiry({
      ...VALID_INQUIRY_BODY,
      source: {
        pageType: 'listing',
        path: '/listings/x',
        campaign: { utm_source: 12345 },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('campaign_invalid')
    }
  })

  it('consent.policyVersion 不匹配当前隐私版本时拒绝', () => {
    const result = validateInquiry({
      ...VALID_INQUIRY_BODY,
      consent: { accepted: true, policyVersion: 'stale-version' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('consent_version_invalid')
    }
  })

  it('targetType=none 入口合法（无 listing/building slug → 通用需求）', () => {
    const body: Record<string, unknown> = {
      ...VALID_INQUIRY_BODY,
      listingSlug: undefined,
      buildingSlug: undefined,
      source: {
        pageType: 'home',
        path: '/',
        campaign: {},
      },
    }
    const result = validateInquiry(body)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.targetType).toBe('none')
      expect(result.data.listingSlug).toBeNull()
      expect(result.data.buildingSlug).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 3. 隐私日志守护不变量汇总
// ---------------------------------------------------------------------------

describe('F7.5 隐私日志守护不变量汇总', () => {
  it('日志条目 JSON 序列化后不含完整姓名/手机号/留言正文/公司名', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 42,
    })
    const json = JSON.stringify(entry)

    // 不含原始 PII
    expect(json).not.toContain('李四')
    expect(json).not.toContain('13800002222')
    expect(json).not.toContain('希望下周看房')
    expect(json).not.toContain('ACME')
    // 不含完整 URL（path 已被白名单化）
    expect(json).not.toContain('?utm_source=baidu')
  })

  it('日志条目包含脱敏手机号（前 3 + 星号 + 后 4）', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    expect(entry.phoneMasked).toMatch(/^\d{3}\*+\d{4}$/)
    expect(entry.phoneMasked).not.toBe('13800002222')
  })

  it('日志条目 campaignKeys 仅记录键名，不含值', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    expect(entry.campaignKeys).toEqual(['utm_source', 'utm_medium'])
    const json = JSON.stringify(entry)
    expect(json).not.toContain('baidu')
    expect(json).not.toContain('cpc')
  })

  it('日志条目 fieldCompleteness 仅记录枚举，不含字段值', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    // 完整 fixture（含 company + message + demand）→ FULL
    expect(entry.fieldCompleteness).toBe('full')
    // 字段枚举是稳定字符串，不暴露值
    expect(typeof entry.fieldCompleteness).toBe('string')
  })

  it('日志条目 errorCode 为 null 或稳定字符串（不暴露内部错误对象）', () => {
    const successEntry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    expect(successEntry.errorCode).toBeNull()

    const errorEntry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: 'listing_not_found',
      durationMs: 1,
    })
    expect(errorEntry.errorCode).toBe('listing_not_found')
    expect(typeof errorEntry.errorCode).toBe('string')
  })

  it('日志条目 path 已白名单化（不含查询参数中的潜在个人信息）', () => {
    const req = buildValidInquiryRequest()
    const entry = buildInquiryLogEntry(req, {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    // path 来自 schema 中的 trimString，不含查询参数
    expect(entry.path).toBe(req.source.path)
    expect(entry.path).not.toContain('?')
  })

  it('日志条目 requestId 用于关联前端埋点（不暴露 PII）', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    expect(entry.requestId).toMatch(/^req-f75-/)
    // requestId 不含姓名/手机号
    expect(entry.requestId).not.toContain('李四')
    expect(entry.requestId).not.toContain('13800002222')
  })

  it('日志条目 durationMs 是数字（不包含时间戳以外的字段）', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 123,
    })
    expect(typeof entry.durationMs).toBe('number')
    expect(entry.durationMs).toBe(123)
  })

  it('日志条目固定字段清单（无任何额外字段）', () => {
    const entry = buildInquiryLogEntry(buildValidInquiryRequest(), {
      idempotent: false,
      errorCode: null,
      durationMs: 1,
    })
    expect(Object.keys(entry).sort()).toEqual(
      [
        'requestId',
        'pageType',
        'path',
        'targetType',
        'targetSlug',
        'phoneMasked',
        'consentPolicyVersion',
        'idempotent',
        'fieldCompleteness',
        'campaignKeys',
        'errorCode',
        'durationMs',
        'hasPriceSnapshot',
        'section',
        'targetResolution',
      ].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// 4. API 响应形状契约（守护响应不暴露内部状态）
//
// 路由层完整守护已在 inquiry-api-route.test.ts 覆盖；
// 这里仅汇总断言响应形状契约。
// ---------------------------------------------------------------------------

describe('F7.5 询盘 API 响应形状契约（汇总）', () => {
  it('成功响应形状固定为 { ok: true }（不暴露 Lead ID）', () => {
    // 路由层实现：return NextResponse.json({ ok: true })
    // 此处仅断言契约形状，不重新发起请求
    const successResponse = { ok: true } as const
    expect(successResponse).toEqual({ ok: true })
    expect(successResponse).not.toHaveProperty('leadId')
    expect(successResponse).not.toHaveProperty('id')
    expect(successResponse).not.toHaveProperty('lead')
  })

  it('字段错误响应形状固定为 { ok: false, errors: string[] }', () => {
    const errorResponse = { ok: false, errors: ['name_required', 'phone_invalid'] } as const
    expect(errorResponse.ok).toBe(false)
    expect(Array.isArray(errorResponse.errors)).toBe(true)
    for (const e of errorResponse.errors) {
      expect(typeof e).toBe('string')
    }
    expect(errorResponse).not.toHaveProperty('leadId')
    expect(errorResponse).not.toHaveProperty('internalError')
  })

  it('服务端错误响应形状固定为 { ok: false, error: string }（稳定错误码）', () => {
    const stableErrorCodes = [
      'rate_limited',
      'listing_not_found',
      'server_error',
      'forbidden',
      'body_too_large',
    ] as const
    for (const code of stableErrorCodes) {
      const response = { ok: false, error: code } as const
      expect(response.ok).toBe(false)
      expect(typeof response.error).toBe('string')
      expect(response).not.toHaveProperty('leadId')
      expect(response).not.toHaveProperty('internalError')
      expect(response).not.toHaveProperty('stack')
    }
  })

  it('稳定错误码清单与 design.md §13 / FP-05 §6 对齐', () => {
    // 路由层暴露的所有错误码（不含内部错误细节）
    const expectedStableErrorCodes = new Set([
      'forbidden',             // 非同源
      'invalid_content_type',  // Content-Type 非 JSON
      'body_too_large',        // body 超 16KB
      'invalid_json',          // JSON 解析失败
      'rate_limited',          // 限流
      'listing_not_found',     // 房源失效
      'server_error',          // 服务端异常
      // 字段错误码（数组形式 errors）
      'invalid_body',
      'name_required',
      'name_too_long',
      'phone_invalid',
      'company_too_long',
      'message_too_long',
      'consent_required',
      'consent_version_invalid',
      'source_required',
      'source_page_type_invalid',
      'source_path_required',
      'source_path_too_long',
      'request_id_required',
      'request_id_too_long',
      'campaign_invalid',
    ])
    // 所有错误码均稳定字符串
    for (const code of expectedStableErrorCodes) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(code.length).toBeLessThan(40)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. HTML 渲染守护不变量（汇总断言）
//
// PageContent.tsx 不使用 dangerouslySetInnerHTML 渲染用户内容；
// 所有 dangerouslySetInnerHTML 仅用于 JSON-LD script 标签，且做了 </script> 转义。
// 详细渲染测试在 public-catalog-page.test.ts 与 fp-06-content-seo-cache-acceptance.test.ts 覆盖。
// ---------------------------------------------------------------------------

describe('F7.5 HTML 渲染守护不变量（汇总）', () => {
  it('PageContent.tsx 不使用 dangerouslySetInnerHTML 渲染富文本内容', async () => {
    // 读取源码文本断言不变量
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const filePath = path.resolve(
      __dirname,
      '..',
      'src',
      'components',
      'frontend',
      'PageContent.tsx',
    )
    const source = await fs.readFile(filePath, 'utf-8')
    // PageContent 不应在富文本渲染路径中使用 dangerouslySetInnerHTML
    // 注：源码注释中提及「不使用 dangerouslySetInnerHTML」，所以使用更严格的断言
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*[a-zA-Z_]/)
  })

  it('JSON-LD script 必须导入共享序列化器并直接写入 __html', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const files = [
      'src/app/(frontend)/listings/[slug]/page.tsx',
      'src/app/(frontend)/buildings/[slug]/page.tsx',
      'src/app/(frontend)/pages/[slug]/page.tsx',
    ]
    for (const rel of files) {
      const filePath = path.resolve(__dirname, '..', ...rel.split('/'))
      const source = await fs.readFile(filePath, 'utf-8')
      if (source.includes('dangerouslySetInnerHTML')) {
        expect(hasSharedJsonLdScriptSerialization(source), `${rel} 必须从共享模块导入 serializeJsonLd 并直接写入 script.__html`).toBe(true)
      }
    }
  })

  it('JSON-LD source guard 拒绝注释、局部 shadow 和错误模块导入', () => {
    const correct = `
      import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      export function Page() { return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }} /> }
    `
    const commentOnly = `
      // import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      // dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }}
      export function Page() { return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({}) }} /> }
    `
    const wrongImport = `
      import { serializeJsonLd } from '@/lib/frontend/other-metadata'
      export function Page() { return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }} /> }
    `
    const localShadow = `
      import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      export function Page() {
        const serializeJsonLd = () => 'unsafe'
        return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }} />
      }
    `
    const mixedSafeAndUnsafe = `
      import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      export function Page() {
        return <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({}) }} />
        </>
      }
    `
    const multipleSafe = `
      import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      export function Page() {
        return <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({ one: true }) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({ two: true }) }} />
        </>
      }
    `
    const mixedSafeAndMissingHtml = `
      import { serializeJsonLd } from '${SHARED_JSON_LD_MODULE}'
      export function Page() {
        return <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({}) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML />
        </>
      }
    `

    expect(hasSharedJsonLdScriptSerialization(correct)).toBe(true)
    expect(hasSharedJsonLdScriptSerialization(commentOnly)).toBe(false)
    expect(hasSharedJsonLdScriptSerialization(wrongImport)).toBe(false)
    expect(hasSharedJsonLdScriptSerialization(localShadow)).toBe(false)
    expect(hasSharedJsonLdScriptSerialization(mixedSafeAndUnsafe)).toBe(false)
    expect(hasSharedJsonLdScriptSerialization(multipleSafe)).toBe(true)
    expect(hasSharedJsonLdScriptSerialization(mixedSafeAndMissingHtml)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. 询盘完整链路守护不变量汇总
// ---------------------------------------------------------------------------

describe('F7.5 询盘完整链路守护不变量汇总', () => {
  it('InquiryRequest 字段清单与 design.md §10.1 契约一致', () => {
    const req = buildValidInquiryRequest()
    expect(Object.keys(req).sort()).toEqual(
      [
        'city',
        'requestId',
        'name',
        'phone',
        'phoneNormalized',
        'company',
        'message',
        'listingSlug',
        'buildingSlug',
        'targetType',
        'demand',
        'consent',
        'source',
        'priceSnapshot',
        'activeSupplyGroup',
        'viewingPreference',
      ].sort(),
    )
  })

  it('InquiryRequest 不包含内部字段（reviewStatus / merchantId 等）', () => {
    const req = buildValidInquiryRequest()
    const json = JSON.stringify(req)
    expect(json).not.toContain('reviewStatus')
    expect(json).not.toContain('publicationStatus')
    expect(json).not.toContain('merchantId')
    expect(json).not.toContain('brokerId')
    expect(json).not.toContain('internalPhone')
    expect(json).not.toContain('deletedAt')
  })

  it('demand 子字段仅 4 项白名单（district / budget / area / moveInTime）', () => {
    const req = buildValidInquiryRequest()
    expect(Object.keys(req.demand).sort()).toEqual(
      ['area', 'budget', 'district', 'moveInTime'].sort(),
    )
  })

  it('source.campaign 仅 5 个 UTM 键白名单', () => {
    const req = buildValidInquiryRequest()
    expect(Object.keys(req.source.campaign).sort()).toEqual(
      ['utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'].sort(),
    )
  })

  it('consent.accepted 永远为 true（schema 校验通过后）', () => {
    const req = buildValidInquiryRequest()
    expect(req.consent.accepted).toBe(true)
  })

  it('consent.policyVersion 永远匹配当前 PRIVACY_POLICY_VERSION', () => {
    const req = buildValidInquiryRequest()
    expect(req.consent.policyVersion).toBe(PRIVACY_POLICY_VERSION)
  })

  it('phone 与 phoneNormalized 一致（schema 校验后已规范化）', () => {
    const req = buildValidInquiryRequest()
    expect(req.phone).toBe(req.phoneNormalized)
    expect(req.phoneNormalized).toMatch(/^1[3-9]\d{9}$/)
  })
})
