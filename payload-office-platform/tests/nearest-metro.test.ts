import { describe, expect, it } from 'vitest'

import {
  buildNearestMetroPlan,
  coordinateFingerprint,
  coordinateProblem,
  haversineMeters,
  lineCoverage,
  selectProposals,
  type BuildingPoint,
  type StationPoint,
} from '../scripts/lib/nearest-metro'

// 上海两个真实站点（高德 GCJ-02）与一个外地站点
const LUJIAZUI: StationPoint = { id: 10, name: '陆家嘴', slug: 'shanghai-metro-lujiazui', lineId: 2, cityId: 1, lat: 31.238259, lng: 121.502129 }
const XIZANG_BEILU: StationPoint = { id: 11, name: '西藏北路', slug: 'shanghai-metro-xizang-beilu', lineId: 8, cityId: 1, lat: 31.263453, lng: 121.468818 }
const HANGZHOU: StationPoint = { id: 20, name: '凤起路', slug: 'hangzhou-metro-fengqilu', lineId: 30, cityId: 2, lat: 30.263, lng: 120.169 }

const building = (over: Partial<BuildingPoint> & Pick<BuildingPoint, 'id'>): BuildingPoint => ({
  slug: `b-${over.id}`,
  name: `楼盘${over.id}`,
  status: 'published',
  cityId: 1,
  lat: null,
  lng: null,
  nearestMetroId: null,
  ...over,
})

describe('haversineMeters', () => {
  it('同一点为 0；陆家嘴站到西藏北路站约 4.2 公里', () => {
    expect(haversineMeters(LUJIAZUI, LUJIAZUI)).toBe(0)
    expect(haversineMeters(LUJIAZUI, XIZANG_BEILU)).toBeGreaterThan(4100)
    expect(haversineMeters(LUJIAZUI, XIZANG_BEILU)).toBeLessThan(4300)
  })
})

describe('coordinateProblem', () => {
  it('正常坐标与缺坐标都不算问题；越界、(0,0)、经纬度写反要进人工清单', () => {
    expect(coordinateProblem(31.23, 121.5)).toBeNull()
    expect(coordinateProblem(null, null)).toBeNull()
    expect(coordinateProblem(0, 0)).toContain('(0, 0)')
    expect(coordinateProblem(121.5, 31.23)).toContain('写反')
    expect(coordinateProblem(48.85, 2.35)).toContain('国内')
  })
})

describe('buildNearestMetroPlan', () => {
  const stations = [LUJIAZUI, XIZANG_BEILU, HANGZHOU]

  it('同城里找最近站；阈值内进建议，阈值外进待人工确认', () => {
    const plan = buildNearestMetroPlan({
      stations,
      maxDistanceMeters: 1000,
      buildings: [
        // 金茂大厦附近，离陆家嘴站约 400 米
        building({ id: 1, lat: 31.2353, lng: 121.5058 }),
        // 离两站都远（约 3 公里外的世纪公园方向）
        building({ id: 2, lat: 31.2195, lng: 121.5450 }),
      ],
    })
    expect(plan.proposals.map((p) => [p.buildingId, p.stationName])).toEqual([[1, '陆家嘴']])
    expect(plan.proposals[0].distanceMeters).toBeGreaterThan(300)
    expect(plan.proposals[0].distanceMeters).toBeLessThan(600)
    expect(plan.tooFar.map((p) => p.buildingId)).toEqual([2])
    expect(plan.distribution.count).toBe(2)
    expect(plan.distribution.within['1000']).toBe(1)
  })

  it('不会配到外地站点；城市下没有站就单独计数', () => {
    const plan = buildNearestMetroPlan({
      stations: [LUJIAZUI],
      maxDistanceMeters: 100_000,
      buildings: [building({ id: 3, cityId: 2, lat: 30.27, lng: 120.17 })],
    })
    expect(plan.proposals).toEqual([])
    expect(plan.counts.noStationInCity).toBe(1)
  })

  it('已填过的不动，但给出计算结果对照；缺坐标、坐标异常、缺城市分别计数', () => {
    const plan = buildNearestMetroPlan({
      stations,
      maxDistanceMeters: 1000,
      buildings: [
        building({ id: 4, nearestMetroId: 11, lat: 31.2353, lng: 121.5058 }),
        building({ id: 5, nearestMetroId: 10 }),
        building({ id: 6 }),
        building({ id: 7, lat: 121.5058, lng: 31.2353 }),
        building({ id: 8, cityId: null, lat: 31.2353, lng: 121.5058 }),
      ],
    })
    expect(plan.alreadySet).toEqual([
      { buildingId: 4, buildingSlug: 'b-4', buildingName: '楼盘4', currentStationId: 11, computed: { stationId: 10, stationName: '陆家嘴', distanceMeters: expect.any(Number) } },
      { buildingId: 5, buildingSlug: 'b-5', buildingName: '楼盘5', currentStationId: 10, computed: null },
    ])
    expect(plan.counts).toMatchObject({ buildings: 5, alreadySet: 2, noCoordinates: 1, invalidCoordinates: 1, noCity: 1, proposals: 0 })
    expect(plan.invalid[0]).toMatchObject({ buildingId: 7, reason: '经纬度疑似写反' })
  })
})

describe('计划里不出现楼盘坐标（坐标受字段权限保护，计划会入库）', () => {
  it('建议与异常清单只带坐标指纹，没有经纬度；指纹对数字和数字字符串一致', () => {
    const plan = buildNearestMetroPlan({
      stations: [LUJIAZUI],
      maxDistanceMeters: 1000,
      buildings: [building({ id: 1, lat: 31.2353, lng: 121.5058 }), building({ id: 2, lat: 121.5058, lng: 31.2353 })],
    })
    const text = JSON.stringify(plan)
    expect(text).not.toContain('31.2353')
    expect(text).not.toContain('121.5058')
    expect(plan.proposals[0].coordinateFingerprint).toBe(coordinateFingerprint(31.2353, 121.5058))
    expect(coordinateFingerprint(Number('31.235300'), Number('121.50580'))).toBe(coordinateFingerprint(31.2353, 121.5058))
    expect(coordinateFingerprint(31.2354, 121.5058)).not.toBe(coordinateFingerprint(31.2353, 121.5058))
  })
})

describe('selectProposals / lineCoverage', () => {
  const plan = buildNearestMetroPlan({
    stations: [LUJIAZUI, XIZANG_BEILU],
    maxDistanceMeters: 2000,
    buildings: [building({ id: 1, lat: 31.2353, lng: 121.5058 }), building({ id: 2, lat: 31.2600, lng: 121.4800 })],
  })

  it('执行时可以比计划更严，不能更宽', () => {
    expect(selectProposals(plan, 600).map((p) => p.buildingId)).toEqual([1])
    expect(selectProposals(plan, 2000)).toHaveLength(2)
    expect(() => selectProposals(plan, 3000)).toThrow('重新出计划')
  })

  it('按线路汇总覆盖的楼盘数', () => {
    expect(lineCoverage(plan.proposals, new Map([[2, '2号线'], [8, '8号线']]))).toEqual([
      { lineId: 2, lineName: '2号线', buildings: 1 },
      { lineId: 8, lineName: '8号线', buildings: 1 },
    ])
  })
})
