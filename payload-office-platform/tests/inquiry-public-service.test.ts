import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  PublicInquirySubmissionError,
  findExistingInquiryResult,
  submitPublicInquiry,
  type PublicInquiryCommand,
  type PublicInquiryDeps,
  type TrustedInquiryCity,
} from '@/domain/inquiry/public-service'
import { computeIdempotencyKeySync, type InquiryRequest } from '@/domain/inquiry'
import { leadsUniqueViolation } from './helpers/unique-violation-fixtures'

const INQUIRY: InquiryRequest = {
  city: 'shanghai',
  requestId: 'req-public-service-001',
  name: '张三',
  phone: '13800001111',
  phoneNormalized: '13800001111',
  company: 'ACME',
  message: '想约看',
  listingSlug: 'jingan-center-100-monthly',
  buildingSlug: 'jingan-center',
  targetType: 'listing',
  demand: {
    district: '静安',
    budget: '1-2 万',
    area: '100 ㎡',
    moveInTime: '9 月',
  },
  consent: { accepted: true, policyVersion: 'privacy-v-test' },
  source: {
    pageType: 'listing',
    path: '/listings/jingan-center-100-monthly',
    section: 'hero',
    currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
    campaign: {
      utm_source: 'baidu',
      utm_medium: '',
      utm_campaign: '',
      utm_content: '',
      utm_term: '',
    },
  },
  priceSnapshot: {
    amount: 8.5,
    currency: 'CNY',
    period: 'day',
    unit: 'rmb-sqm-day',
  },
  activeSupplyGroup: 'lease',
  viewingPreference: null,
}

const TRUSTED_KEY = computeIdempotencyKeySync(
  INQUIRY.requestId,
  INQUIRY.phoneNormalized,
  INQUIRY.targetType,
  INQUIRY.listingSlug ?? '',
)

function command(overrides: Partial<PublicInquiryCommand> = {}): PublicInquiryCommand {
  return {
    inquiry: INQUIRY,
    trustedIdempotencyKey: TRUSTED_KEY,
    defaultCity: 'shanghai',
    siteOrigin: 'https://www.sbh.example',
    viewingPreference: null,
    ...overrides,
  }
}

function deps(overrides: Partial<PublicInquiryDeps> = {}): PublicInquiryDeps {
  return {
    findExistingLead: vi.fn(async () => null),
    resolveCity: vi.fn(async (slug) =>
      slug === 'shanghai'
        ? { id: 1, slug: 'shanghai' }
        : null,
    ),
    assertEffectiveListing: vi.fn(async () => ({ id: 101 })),
    assertEffectiveBuilding: vi.fn(async () => ({ id: 201, slug: 'jingan-center' })),
    findOwningBuildingSlug: vi.fn(async () => 'jingan-center'),
    createLead: vi.fn(async () => undefined),
    isIdempotencyUniqueViolation: vi.fn(() => false),
    nowIso: vi.fn(() => '2026-08-27T08:00:00.000Z'),
    ...overrides,
  }
}

function promiseBarrier(participants: number): () => Promise<void> {
  let arrivals = 0
  let release!: () => void
  const ready = new Promise<void>((resolveReady) => { release = resolveReady })
  return async () => {
    arrivals += 1
    if (arrivals === participants) release()
    await ready
  }
}

describe('共享公开询盘领域服务', () => {
  it('可信幂等键在编译期不是普通 string', () => {
    expectTypeOf<string>().not.toMatchTypeOf<PublicInquiryCommand['trustedIdempotencyKey']>()
  })

  it('拒绝伪造的普通幂等键且不解析城市、不预查、不写入', async () => {
    const serviceDeps = deps()
    const forgedKey = 'not-a-server-generated-sha256' as PublicInquiryCommand['trustedIdempotencyKey']

    await expect(submitPublicInquiry(command({ trustedIdempotencyKey: forgedKey }), serviceDeps))
      .rejects.toMatchObject({ code: 'idempotency_key_invalid' })
    expect(serviceDeps.resolveCity).not.toHaveBeenCalled()
    expect(serviceDeps.findExistingLead).not.toHaveBeenCalled()
    expect(serviceDeps.createLead).not.toHaveBeenCalled()
  })

  it('只读预查边界也拒绝非法 key 且不访问 Lead', async () => {
    const findExistingLead = vi.fn(async () => null)
    const forgedKey = 'invalid-key' as PublicInquiryCommand['trustedIdempotencyKey']

    await expect(findExistingInquiryResult(forgedKey, { findExistingLead }))
      .rejects.toMatchObject({ code: 'idempotency_key_invalid' })
    expect(findExistingLead).not.toHaveBeenCalled()
  })

  it('即使强转也拒绝没有私有 capability 的伪造城市', async () => {
    const serviceDeps = deps()
    const forgedCity = { id: 'forged', slug: 'shanghai' } as unknown as TrustedInquiryCity

    await expect(submitPublicInquiry(command({ trustedCity: forgedCity }), serviceDeps))
      .rejects.toMatchObject({ code: 'city_invalid' })
    expect(serviceDeps.findExistingLead).not.toHaveBeenCalled()
    expect(serviceDeps.createLead).not.toHaveBeenCalled()
  })

  it('只按服务端可信 key 预查并投影首次目标语义', async () => {
    const findExistingLead = vi.fn(async () => ({ targetType: 'building' as const }))

    await expect(findExistingInquiryResult(TRUSTED_KEY, deps({ findExistingLead })))
      .resolves.toEqual({ targetResolution: 'building' })
    expect(findExistingLead).toHaveBeenCalledWith(TRUSTED_KEY)
  })

  it('提交时再次预查，命中后在城市解析之后、供给复核之前返回', async () => {
    const state = { existing: false }
    const findExistingLead = vi.fn(async () =>
      state.existing ? { targetType: 'listing' as const } : null,
    )
    const serviceDeps = deps({ findExistingLead })

    await expect(findExistingInquiryResult(TRUSTED_KEY, serviceDeps)).resolves.toBeNull()
    state.existing = true

    await expect(submitPublicInquiry(command(), serviceDeps)).resolves.toEqual({
      idempotent: true,
      targetResolution: 'listing',
    })
    expect(serviceDeps.resolveCity).toHaveBeenCalledWith('shanghai')
    expect(serviceDeps.assertEffectiveListing).not.toHaveBeenCalled()
    expect(serviceDeps.createLead).not.toHaveBeenCalled()
  })

  it('拒绝无法解析或 slug 不一致的城市，且不查询供给或创建 Lead', async () => {
    const serviceDeps = deps({
      resolveCity: vi.fn(async () => ({ id: 9, slug: 'hangzhou' })),
    })

    await expect(submitPublicInquiry(command(), serviceDeps)).rejects.toMatchObject({
      code: 'city_invalid',
    })
    expect(serviceDeps.findExistingLead).not.toHaveBeenCalled()
    expect(serviceDeps.assertEffectiveListing).not.toHaveBeenCalled()
    expect(serviceDeps.createLead).not.toHaveBeenCalled()
  })

  it('预查失败保持继续创建语义，并保存可信城市、价格快照、隐私版本与完整白名单字段', async () => {
    const onIdempotencyCheckError = vi.fn()
    const serviceDeps = deps({
      findExistingLead: vi.fn(async () => { throw new Error('read unavailable') }),
      onIdempotencyCheckError,
    })

    await expect(submitPublicInquiry(command(), serviceDeps)).resolves.toEqual({
      idempotent: false,
      targetResolution: 'listing',
    })
    expect(onIdempotencyCheckError).toHaveBeenCalledTimes(1)
    expect(serviceDeps.createLead).toHaveBeenCalledWith(expect.objectContaining({
      city: 1,
      interestedListing: 101,
      idempotencyKey: TRUSTED_KEY,
      sourceUrl: 'https://www.sbh.example/listings/jingan-center-100-monthly',
      targetType: 'listing',
      targetListingSlug: 'jingan-center-100-monthly',
      targetBuildingSlug: null,
      priceSnapshot: INQUIRY.priceSnapshot,
      priceSnapshotSubmittedAt: '2026-08-27T08:00:00.000Z',
      consentAccepted: true,
      consentPolicyVersion: 'privacy-v-test',
    }))
  })

  it('房源失效时只允许降级到其真实所属的有效楼盘', async () => {
    const serviceDeps = deps({
      assertEffectiveListing: vi.fn(async () => null),
    })

    await expect(submitPublicInquiry(command(), serviceDeps)).resolves.toEqual({
      idempotent: false,
      targetResolution: 'building',
    })
    expect(serviceDeps.assertEffectiveBuilding).toHaveBeenCalledWith('jingan-center', 'shanghai')
    expect(serviceDeps.createLead).toHaveBeenCalledWith(expect.objectContaining({
      interestedListing: undefined,
      targetType: 'building',
      targetListingSlug: null,
      targetBuildingSlug: 'jingan-center',
    }))
  })

  it('客户端伪造楼盘归属时降级为通用需求且不复核伪造楼盘', async () => {
    const serviceDeps = deps({
      assertEffectiveListing: vi.fn(async () => null),
      findOwningBuildingSlug: vi.fn(async () => 'real-building'),
    })

    await expect(submitPublicInquiry(command(), serviceDeps)).resolves.toEqual({
      idempotent: false,
      targetResolution: 'general',
    })
    expect(serviceDeps.assertEffectiveBuilding).not.toHaveBeenCalled()
    expect(serviceDeps.createLead).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'none',
      targetListingSlug: null,
      targetBuildingSlug: null,
    }))
  })

  it('创建撞 leads 唯一约束后回读并返回首次成功语义', async () => {
    const findExistingLead = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ targetType: 'building' })
    const serviceDeps = deps({
      findExistingLead,
      createLead: vi.fn(async () => { throw leadsUniqueViolation() }),
      isIdempotencyUniqueViolation: vi.fn(() => true),
    })

    await expect(submitPublicInquiry(command(), serviceDeps)).resolves.toEqual({
      idempotent: true,
      targetResolution: 'building',
    })
    expect(findExistingLead).toHaveBeenCalledTimes(2)
  })

  it('真实 Promise barrier 让不同 phone/同 key 的两次预查同时 miss，唯一冲突后只持久化一条', async () => {
    const bothPrechecksMiss = promiseBarrier(2)
    const bothCreatesStarted = promiseBarrier(2)
    const persisted: Array<Readonly<{ phone: string; targetType: 'listing' }>> = []
    let precheckCount = 0
    let createAttempts = 0
    const serviceDeps = deps({
      findExistingLead: vi.fn(async () => {
        precheckCount += 1
        if (precheckCount <= 2) {
          await bothPrechecksMiss()
          return null
        }
        return persisted[0] ?? null
      }),
      createLead: vi.fn(async (data) => {
        createAttempts += 1
        await bothCreatesStarted()
        if (persisted.length > 0) throw leadsUniqueViolation()
        persisted.push({ phone: data.phone, targetType: 'listing' })
      }),
      isIdempotencyUniqueViolation: vi.fn((error) =>
        typeof error === 'object' && error !== null,
      ),
    })
    const secondInquiry: InquiryRequest = {
      ...INQUIRY,
      phone: '13900002222',
      phoneNormalized: '13900002222',
    }

    const results = await Promise.all([
      submitPublicInquiry(command(), serviceDeps),
      submitPublicInquiry(command({ inquiry: secondInquiry }), serviceDeps),
    ])

    expect(createAttempts).toBe(2)
    expect(persisted).toHaveLength(1)
    expect(['13800001111', '13900002222']).toContain(persisted[0]?.phone)
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true])
    expect(results.map((result) => result.targetResolution)).toEqual(['listing', 'listing'])
  })

  it('非唯一创建错误以稳定领域错误冒泡且不泄露到成功结果', async () => {
    const cause = new Error('postgres internal endpoint')
    const serviceDeps = deps({ createLead: vi.fn(async () => { throw cause }) })

    await expect(submitPublicInquiry(command(), serviceDeps)).rejects.toEqual(
      expect.objectContaining<Partial<PublicInquirySubmissionError>>({
        code: 'create_failed',
        cause,
      }),
    )
  })

  it('服务实现不依赖 Web/微信/Auth 或 Payload 运行时', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/domain/inquiry/public-service.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/NextResponse|\bRequest\b|getPayload|wechat|Authorization/)
    expect(source).not.toMatch(/from ['"]payload['"]/)
  })
})
