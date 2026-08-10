import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import {
  countForCities,
  countForDistricts,
  countForBusinessAreas,
  countForMetroLines,
  shapeCityCounts,
  shapeDistrictCounts,
  shapeBusinessAreaCounts,
  shapeMetroLineCounts,
} from '../src/domain/geography/location-counts'

const ZERO_CITY = {
  districts: 0,
  businessAreas: 0,
  businessAreasMissingBoundary: 0,
  metroLines: 0,
  metroStations: 0,
  buildings: 0,
}

describe('location-counts/整形纯函数', () => {
  it('空结果：所有请求的 id 都出现，计数补 0', () => {
    const map = shapeCityCounts([], [], [1, 2, 3])
    expect(map.size).toBe(3)
    expect(map.get(1)).toEqual(ZERO_CITY)
    expect(map.get(2)).toEqual(ZERO_CITY)
    expect(map.get(3)).toEqual(ZERO_CITY)
  })

  it('缺失 id 补 0：只有部分 id 命中行时，未命中的保持 0', () => {
    const map = shapeCityCounts(
      [{ id: 1, districts: '16', business_areas: '3', metro_lines: '2', metro_stations: '5', missing_boundary: '1' }],
      [],
      [1, 9],
    )
    expect(map.get(1)).toEqual({
      ...ZERO_CITY,
      districts: 16,
      businessAreas: 3,
      businessAreasMissingBoundary: 1,
      metroLines: 2,
      metroStations: 5,
    })
    expect(map.get(9)).toEqual(ZERO_CITY)
  })

  it('多组行按 id 合并：厂家行叠加到位置行之上，互不覆盖', () => {
    const map = shapeCityCounts(
      [{ id: 1, districts: '16', business_areas: '3', metro_lines: '2', metro_stations: '5', missing_boundary: '1' }],
      [{ id: 1, buildings: '40' }, { id: 2, buildings: '7' }],
      [1, 2],
    )
    expect(map.get(1)).toEqual({
      ...ZERO_CITY,
      districts: 16,
      businessAreas: 3,
      businessAreasMissingBoundary: 1,
      metroLines: 2,
      metroStations: 5,
      buildings: 40,
    })
    // 2 只有楼盘行，位置计数补 0
    expect(map.get(2)).toEqual({ ...ZERO_CITY, buildings: 7 })
  })

  it('bigint 字符串计数被正确转成 number', () => {
    const map = shapeCityCounts(
      [{ id: '100', districts: '16' }],
      [],
      [100],
    )
    expect(map.get(100)?.districts).toBe(16)
  })

  it('district / business-area / metro-line 各自整形', () => {
    expect(shapeDistrictCounts([{ id: 1, business_areas: '4' }], [{ id: 1, buildings: '9' }], [1])).toEqual(
      new Map([[1, { businessAreas: 4, buildings: 9 }]]),
    )
    expect(shapeBusinessAreaCounts([], [{ id: 1, stations: '3', metro_lines: '2' }], [1])).toEqual(
      new Map([[1, { buildings: 0, stations: 3, metroLines: 2 }]]),
    )
    expect(shapeMetroLineCounts([], [5])).toEqual(new Map([[5, { stations: 0 }]]))
  })
})

describe('location-counts/SQL 条数不随 ids 长度增长', () => {
  function makePayload(track: string[]): Payload {
    const mockDb = {
      execute: async (query: { toString?: unknown }) => {
        track.push(String((query as { value?: unknown })?.value ?? query))
        return { rows: [] }
      },
    }
    return { db: { drizzle: mockDb } } as unknown as Payload
  }

  it('countForCities 固定 2 条 SQL，与 ids 长度无关', async () => {
    const calls3: string[] = []
    await countForCities(makePayload(calls3), [1, 2, 3])
    const calls50: string[] = []
    await countForCities(makePayload(calls50), Array.from({ length: 50 }, (_, i) => i + 1))
    expect(calls3.length).toBe(2)
    expect(calls50.length).toBe(2)
  })

  it('countForDistricts / countForBusinessAreas 固定 2 条，countForMetroLines 固定 1 条', async () => {
    const d: string[] = []
    await countForDistricts(makePayload(d), [1, 2])
    const a: string[] = []
    await countForBusinessAreas(makePayload(a), [1, 2])
    const l: string[] = []
    await countForMetroLines(makePayload(l), [1, 2])
    expect(d.length).toBe(2)
    expect(a.length).toBe(2)
    expect(l.length).toBe(1)
  })

  it('ids 为空：直接返回空 Map，不发 SQL', async () => {
    const calls: string[] = []
    const map = await countForCities(makePayload(calls), [])
    expect(map.size).toBe(0)
    expect(calls.length).toBe(0)
  })
})