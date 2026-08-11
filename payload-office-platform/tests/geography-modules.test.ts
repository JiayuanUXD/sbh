import { describe, it, expect } from 'vitest'

import {
  GEOGRAPHY_MODULES,
  getGeographyModuleByCreatePath,
  getGeographyModuleByPath,
  type GeographyColumn,
} from '@/components/admin/geography/geography-modules'
import type { LocationType } from '@/domain/geography/location-hierarchy'

/** 计算列 = count 类列，来自 Task 5 聚合 SQL，**不可排序**（A2 决策）。 */
const countKeys = (cols: GeographyColumn[]) =>
  cols.filter((c) => c.kind === 'count').map((c) => c.key)

const MODULE_TYPES: LocationType[] = ['city', 'district', 'business_area', 'metro_line']

describe('geography-modules/四模块共享列表配置', () => {
  it('注册四个模块，类型/标题/路由/筛选齐全', () => {
    const expectModule = (type: LocationType, title: string, route: string, filters: string[]) => {
      const m = GEOGRAPHY_MODULES[type]
      expect(m).toBeDefined()
      expect(m?.title).toBe(title)
      expect(m?.route).toBe(route)
      expect(m?.filters).toEqual(filters)
    }
    expectModule('city', '城市管理', '/geography/cities', ['status', 'keyword'])
    expectModule('district', '行政区管理', '/geography/districts', ['city', 'status', 'keyword'])
    expectModule('business_area', '商圈管理', '/geography/business-areas', ['city', 'district', 'status', 'keyword'])
    expectModule('metro_line', '地铁管理', '/geography/metro-lines', ['city', 'status', 'keyword'])
  })

  it('城市模块列与计划一致（10 列，6 个计算列）', () => {
    const m = GEOGRAPHY_MODULES.city!
    expect(m.columns).toHaveLength(10)
    expect(countKeys(m.columns)).toEqual([
      'districts',
      'businessAreas',
      'missingBoundary',
      'metroLines',
      'metroStations',
      'buildings',
    ])
  })

  it('计算列全部为 count 类（不可排序），字段列不含聚合计数', () => {
    for (const type of MODULE_TYPES) {
      const m = GEOGRAPHY_MODULES[type]!
      for (const c of m.columns) {
        if (c.kind === 'count') {
          // 计数键来自聚合服务，绝不来自 row 直接字段
          expect(c.source.startsWith('count')).toBe(false)
        }
      }
    }
  })

  it('getGeographyModuleByPath 依 admin 路径解析模块', () => {
    expect(getGeographyModuleByPath('/admin/geography/cities')?.type).toBe('city')
    expect(getGeographyModuleByPath('/admin/geography/districts')?.type).toBe('district')
    expect(getGeographyModuleByPath('/admin/geography/business-areas')?.type).toBe('business_area')
    expect(getGeographyModuleByPath('/admin/geography/metro-lines')?.type).toBe('metro_line')
    // 未知路径 → null，调用方兜底
    expect(getGeographyModuleByPath('/admin/geography/unknown')).toBeNull()
  })

  it('每个模块都有计数服务与空态文案', () => {
    for (const type of MODULE_TYPES) {
      const m = GEOGRAPHY_MODULES[type]!
      expect(typeof m.counter).toBe('function')
      expect(m.emptyHint.length).toBeGreaterThan(0)
    }
  })

  it('行政区模块有新建配置：type=district，父级取城市筛选', () => {
    const c = GEOGRAPHY_MODULES.district?.create
    expect(c).toMatchObject({
      type: 'district',
      parentFilter: 'city',
      parentTargetType: 'city',
    })
    expect(c?.label.length).toBeGreaterThan(0)
  })

  it('getGeographyModuleByCreatePath 仅解析带新建配置的 /<route>/new', () => {
    expect(getGeographyModuleByCreatePath('/admin/geography/districts/new')?.type).toBe('district')
    // 列表路径（非 /new）与无新建配置的模块（城市）都不命中
    expect(getGeographyModuleByCreatePath('/admin/geography/districts')).toBeNull()
    expect(getGeographyModuleByCreatePath('/admin/geography/cities/new')).toBeNull()
    expect(getGeographyModuleByCreatePath('/admin/geography/unknown/new')).toBeNull()
  })
})