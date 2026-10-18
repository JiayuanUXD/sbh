import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ home: vi.fn(), buildings: vi.fn(), building: vi.fn(), listing: vi.fn() }))
vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniHome: io.home, getMiniBuildings: io.buildings,
  getMiniBuildingDetail: io.building, getMiniListingDetail: io.listing,
}))
import { GET as homeRoute } from '@/app/api/mini/v1/home/route'
import { GET as buildingsRoute } from '@/app/api/mini/v1/buildings/route'
import { GET as buildingRoute } from '@/app/api/mini/v1/buildings/[slug]/route'
import { GET as listingRoute } from '@/app/api/mini/v1/listings/[slug]/route'

const canonicalGrades = ['super-grade-a', 'grade-a', 'grade-b', 'ungraded', null]
const cards = canonicalGrades.map((grade, i) => ({ id: String(i), slug: `building-${i}`, grade }))
const shared = {
  home: { featuredBuildings: cards },
  buildings: { items: cards, inactiveItems: [{ grade: 'ungraded' }] },
  building: { grade: 'grade-b', comparableBuildings: cards },
  listing: { buildingInfo: { grade: 'ungraded' } },
}
function grades(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(grades)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => key === 'grade' ? [child] : grades(child))
}
beforeEach(() => {
  io.home.mockResolvedValue({ asOf: '2026-10-18', data: shared.home })
  io.buildings.mockResolvedValue({ asOf: '2026-10-18', data: shared.buildings })
  io.building.mockResolvedValue({ status: 'ok', snapshot: { asOf: '2026-10-18', data: shared.building } })
  io.listing.mockResolvedValue({ status: 'ok', snapshot: { asOf: '2026-10-18', data: shared.listing } })
})

describe('Mini v1等级能力协商的HTTP边界', () => {
  it.each(['', '&gradeSchema=unknown', '&gradeSchema=quality-v1'])('请求%s覆盖全部公开等级路径且不改共享canonical快照', async schema => {
    const load = (path: string) => new Request(`https://example.test/api/mini/v1/${path}?city=shanghai${schema}`)
    const responses = await Promise.all([
      homeRoute(load('home')), buildingsRoute(load('buildings')),
      buildingRoute(load('buildings/test'), { params: Promise.resolve({ slug: 'test' }) }),
      listingRoute(load('listings/test'), { params: Promise.resolve({ slug: 'test' }) }),
    ])
    const expectedCards = schema.endsWith('quality-v1') ? canonicalGrades : ['super-grade-a', 'grade-a', null, null, null]
    const newGrade = schema.endsWith('quality-v1') ? 'grade-b' : null
    const ungraded = schema.endsWith('quality-v1') ? 'ungraded' : null
    const expected = [expectedCards, [...expectedCards, ungraded], [newGrade, ...expectedCards], [ungraded]]
    for (let i = 0; i < responses.length; i++) {
      expect(responses[i].status).toBe(200)
      expect(grades(await responses[i].json()).map(String).sort()).toEqual(expected[i].map(String).sort())
    }
    expect(shared.home.featuredBuildings.map(card => card.grade)).toEqual(canonicalGrades)
    expect(shared.building.grade).toBe('grade-b')
    expect(shared.listing.buildingInfo.grade).toBe('ungraded')
  })
  it('相同canonical缓存先新后旧再新请求，版本输出互不污染', async () => {
    for (const [schema, expected] of [['quality-v1', canonicalGrades], ['', ['super-grade-a', 'grade-a', null, null, null]], ['unknown', ['super-grade-a', 'grade-a', null, null, null]], ['quality-v1', canonicalGrades]] as const) {
      const response = await homeRoute(new Request(`https://example.test/api/mini/v1/home?city=shanghai&gradeSchema=${schema}`))
      expect(grades(await response.json())).toEqual(expected)
    }
  })
})
