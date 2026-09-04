/**
 * 可解释情境推荐 - 单元测试（P2 Task 5）
 *
 * 验证：
 *   - 同商圈、同类型、同单位、相近面积按权重打分，同分 ID 升序收束
 *   - 最多返回 6 条，每条至少一个 reasonCode
 *   - context 不接受用户 ID、手机号或跨会话历史
 *   - 排序确定性：相同输入始终产出相同顺序
 */
import { describe, expect, it } from 'vitest'
import {
  createPayloadSupplyAdapter,
  createSearchContext,
  getDetailRecommendations,
  rowsFromListings,
} from '@/domain/public-catalog'
import {
  rankDetailRecommendations,
  parseRecommendationContext,
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationResult,
} from '@/domain/recommendation/detail-recommendations'
import {
  LISTING_MONTHLY_STANDARD,
} from '@/test/frontend/payload-documents'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CANDIDATE: RecommendationCandidate = {
  id: 100,
  listingType: 'traditional-office',
  businessType: 'lease',
  area: 150,
  priceAmount: 8.5,
  priceUnit: 'rmb-sqm-day',
  buildingDistrictId: 1,
  buildingBusinessDistrictId: 10,
}

function candidate(overrides: Partial<RecommendationCandidate>): RecommendationCandidate {
  return { ...BASE_CANDIDATE, ...overrides }
}

const CONTEXT: RecommendationContext = {
  currentListingId: 99,
  listingType: 'traditional-office',
  businessType: 'lease',
  area: 150,
  priceAmount: 8.5,
  priceUnit: 'rmb-sqm-day',
  buildingDistrictId: 1,
  buildingBusinessDistrictId: 10,
}

const CANDIDATES: RecommendationCandidate[] = [
  // id=12: 同商圈 + 同单位 + 相近面积 → 高分
  candidate({ id: 12, buildingBusinessDistrictId: 10, priceUnit: 'rmb-sqm-day', area: 160 }),
  // id=18: 同商圈 + 同类型 → 中高分
  candidate({ id: 18, buildingBusinessDistrictId: 10, listingType: 'traditional-office', priceUnit: 'rmb-month', area: 500 }),
  // id=23: 同商圈 + 相近价格 → 中分
  candidate({ id: 23, buildingBusinessDistrictId: 10, listingType: 'serviced-office', priceUnit: 'rmb-sqm-day', area: 300, priceAmount: 8.8 }),
  // id=5: 不同商圈但同类型 + 同单位 → 较低分
  candidate({ id: 5, buildingBusinessDistrictId: 99, listingType: 'traditional-office', priceUnit: 'rmb-sqm-day', area: 200 }),
  // id=50: 完全不同 → 最低分
  candidate({ id: 50, buildingBusinessDistrictId: 99, listingType: 'coworking', priceUnit: 'rmb-seat-month', area: 20, priceAmount: 2000 }),
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rankDetailRecommendations', () => {
  it('preserves canonical city identity on recommendation DTO cards', async () => {
    const candidateListing = {
      ...LISTING_MONTHLY_STANDARD,
      id: 1010,
      slug: 'recommended-office',
      title: '推荐办公室',
    }
    // OPT-068：推荐链路是「扫描候选 → 打分 → 回捞获胜卡片」。这份替身从生产
    // 适配器展开而来，因此**必须**把这三个方法都盖掉——漏掉任何一个，剩下的那个
    // 会真的去连库（表现为本用例 5 秒超时，不是断言失败）。
    const adapter = {
      ...createPayloadSupplyAdapter(),
      async findEffectiveListingBySlug() {
        return LISTING_MONTHLY_STANDARD
      },
      async findEffectiveListings() {
        return [candidateListing]
      },
      async scanEffectiveListings() {
        return rowsFromListings([candidateListing])
      },
      async findEffectiveListingsByIds(ids: readonly number[]) {
        return ids.includes(candidateListing.id) ? [candidateListing] : []
      },
    }

    const recommendations = await getDetailRecommendations(
      LISTING_MONTHLY_STANDARD.slug,
      createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z')),
      {},
      adapter,
    )

    expect(recommendations[0]?.card).toMatchObject({
      citySlug: 'shanghai',
      cityName: '上海市',
    })
  })

  it('同商圈、同单位、相近面积按稳定 ID 收束', () => {
    const results = rankDetailRecommendations(CANDIDATES, CONTEXT)
    // 第一名应该是 id=12（同商圈40 + 同类型25 + 同单位20 + 相近面积10 + 相近价格5 = 100）
    expect(results[0].candidate.id).toBe(12)
    expect(results[0].reasonCodes).toContain('same-business-area')
    expect(results[0].reasonCodes).toContain('same-price-unit')
    // 所有结果按分数降序，同分按 ID 升序
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]
      const curr = results[i]
      if (prev.score === curr.score) {
        expect(prev.candidate.id).toBeLessThan(curr.candidate.id)
      } else {
        expect(prev.score).toBeGreaterThan(curr.score)
      }
    }
  })

  it('最多返回 6 条', () => {
    const manyCandidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: i + 1, buildingBusinessDistrictId: 10 }),
    )
    const results = rankDetailRecommendations(manyCandidates, CONTEXT)
    expect(results.length).toBeLessThanOrEqual(6)
  })

  it('每条结果至少有一个 reasonCode', () => {
    const results = rankDetailRecommendations(CANDIDATES, CONTEXT)
    for (const r of results) {
      expect(r.reasonCodes.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('排除当前房源自身', () => {
    const withSelf = [...CANDIDATES, candidate({ id: CONTEXT.currentListingId })]
    const results = rankDetailRecommendations(withSelf, CONTEXT)
    expect(results.every((r) => r.candidate.id !== CONTEXT.currentListingId)).toBe(true)
  })

  it('确定性：相同输入始终产出相同顺序', () => {
    const r1 = rankDetailRecommendations(CANDIDATES, CONTEXT)
    const r2 = rankDetailRecommendations(CANDIDATES, CONTEXT)
    expect(r1.map((r) => r.candidate.id)).toEqual(r2.map((r) => r.candidate.id))
  })

  it('空候选返回空数组', () => {
    const results = rankDetailRecommendations([], CONTEXT)
    expect(results).toEqual([])
  })
})

describe('parseRecommendationContext', () => {
  it('context 不接受用户 ID', () => {
    const result = parseRecommendationContext({ ...CONTEXT, userId: 123 } as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: false, error: 'invalid_context' })
  })

  it('context 不接受手机号', () => {
    const result = parseRecommendationContext({ ...CONTEXT, phone: '13800001111' } as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: false, error: 'invalid_context' })
  })

  it('context 不接受跨会话历史', () => {
    const result = parseRecommendationContext({ ...CONTEXT, sessionHistory: [] } as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: false, error: 'invalid_context' })
  })

  it('context 不接受 cookie', () => {
    const result = parseRecommendationContext({ ...CONTEXT, cookie: 'abc' } as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: false, error: 'invalid_context' })
  })

  it('context 不接受 localStorage', () => {
    const result = parseRecommendationContext({ ...CONTEXT, localStorage: {} } as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: false, error: 'invalid_context' })
  })

  it('合法 context 返回 ok', () => {
    const result = parseRecommendationContext(CONTEXT as unknown as Record<string, unknown>)
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ currentListingId: 99 }) })
  })
})
