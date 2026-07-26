import { describe, expect, it, vi } from 'vitest'

import {
  toId,
  buildEffectiveSnapshot,
  loadRelationPeriod,
  resolveEffectiveSupply,
} from '@/domain/review/effective-supply-snapshot'
import { EFFECTIVE_SUPPLY_EXCLUSION_CODES } from '@/domain/review/effective-supply'

/**
 * M4.7 有效供给快照助手单测
 *
 * 这些助手从 listing-publish-endpoint.ts 提取,供发布 endpoint 与 C 端适配器共用:
 *   - toId：关系字段归一为 id
 *   - buildEffectiveSnapshot：已解析房源文档 → 精筛入参
 *   - loadRelationPeriod：查当前生效的房源-商户关系区间
 *   - resolveEffectiveSupply：一站式(载关系 + 建快照 + 精筛)
 */

const asOf = new Date('2026-07-26T00:00:00.000Z')

/** 有效供给齐全的房源文档(depth≥1 已展开)。 */
function makeListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    building: { id: 5, city: { id: 100 } },
    merchant: {
      id: 20,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...overrides,
  }
}

describe('effective-supply-snapshot/toId', () => {
  it('数字/字符串直接返回', () => {
    expect(toId(5)).toBe(5)
    expect(toId('abc')).toBe('abc')
  })

  it('对象取 id', () => {
    expect(toId({ id: 7 })).toBe(7)
    expect(toId({ id: 'x' })).toBe('x')
  })

  it('null/undefined/无 id 对象 → null', () => {
    expect(toId(null)).toBeNull()
    expect(toId(undefined)).toBeNull()
    expect(toId({})).toBeNull()
  })
})

describe('effective-supply-snapshot/buildEffectiveSnapshot', () => {
  it('从已解析文档抽取媒体数/商户/楼盘城市', () => {
    const snap = buildEffectiveSnapshot(makeListing(), {
      startsAt: '2000-01-01T00:00:00.000Z',
      endsAt: null,
    })
    expect(snap.mediaCount).toBe(3)
    expect(snap.merchant.status).toBe('active')
    expect(snap.merchant.serviceCityIds).toEqual([100])
    expect(snap.buildingCityId).toBe(100)
    expect(snap.relationPeriod).toEqual({ startsAt: '2000-01-01T00:00:00.000Z', endsAt: null })
  })

  it('gallery 缺失 → mediaCount=0', () => {
    const snap = buildEffectiveSnapshot(makeListing({ gallery: undefined }), null)
    expect(snap.mediaCount).toBe(0)
  })

  it('building 缺失 → buildingCityId=null', () => {
    const snap = buildEffectiveSnapshot(makeListing({ building: null }), null)
    expect(snap.buildingCityId).toBeNull()
  })
})

describe('effective-supply-snapshot/loadRelationPeriod', () => {
  it('查到关系 → 转 ValidityPeriod(按 -effectiveFrom 取最近一条)', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    const period = await loadRelationPeriod(payload, 1)
    expect(period).toEqual({ startsAt: '2026-01-01T00:00:00.000Z', endsAt: null })
    const calls = find.mock.calls as unknown as Array<Array<Record<string, unknown>>>
    const arg = calls[0][0]
    expect(arg.collection).toBe('listing-merchant-relations')
    expect(arg.sort).toBe('-effectiveFrom')
    expect(arg.limit).toBe(1)
  })

  it('无关系记录 → null', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    expect(await loadRelationPeriod(payload, 1)).toBeNull()
  })

  it('关系时刻非法 → null(不抛)', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: 'not-a-date', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    expect(await loadRelationPeriod(payload, 1)).toBeNull()
  })
})

describe('effective-supply-snapshot/resolveEffectiveSupply', () => {
  it('有效供给齐全 → eligible=true', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('无关系 → RELATION_NOT_EFFECTIVE', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('媒体不足 → INSUFFICIENT_MEDIA', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing({ gallery: [{ id: 'a' }] }), asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.INSUFFICIENT_MEDIA)
  })
})
