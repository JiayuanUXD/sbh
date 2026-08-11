import { describe, it, expect } from 'vitest'

import {
  GEOGRAPHY_MODULES,
  getGeographyModuleByCreatePath,
  getGeographyModuleByPath,
  type GeographyColumn,
} from '@/components/admin/geography/geography-modules'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import { MENU_CODES } from '@/domain/auth/permission-codes'
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

  it('商圈模块 11 列，含边界/封面两个 flag 列', () => {
    const m = GEOGRAPHY_MODULES.business_area!
    expect(m.columns).toHaveLength(11)
    // 边界/封面是 flag 列，取自 row 布尔字段（hasBoundary/hasCover），非计数
    const flags = m.columns.filter((c) => c.kind === 'flag')
    expect(flags.map((f) => f.key)).toEqual(['hasBoundary', 'hasCover'])
    // 边界/封面列紧随关联线路数之后，位于状态列之前（与计划列序一致）
    const keys = m.columns.map((c) => c.key)
    expect(keys).toEqual([
      'name',
      'immutableCode',
      'parentName',
      'cityName',
      'buildings',
      'stations',
      'metroLines',
      'hasBoundary',
      'hasCover',
      'status',
      'frontendVisible',
    ])
  })

  it('商圈模块提供「仅看缺边界」「仅看缺封面」快捷 chip', () => {
    const chips = GEOGRAPHY_MODULES.business_area?.chips
    expect(chips?.map((c) => c.key)).toEqual(['missingBoundary', 'missingCover'])
    expect(chips?.every((c) => c.label.length > 0)).toBe(true)
    // 其余模块无快捷 chip
    for (const type of ['city', 'district', 'metro_line'] as const) {
      expect(GEOGRAPHY_MODULES[type]?.chips).toBeUndefined()
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

  // —— 审核修复 P1-1：模块准入用的 menuCodes 必须与导航叶子一致 ——
  describe('menuCodes 与导航配置一致（防守卫与入口漂移）', () => {
    /** 摊平导航树，取所有叶子 */
    function allLeaves(): { href: string; menuCodes: readonly string[] }[] {
      const out: { href: string; menuCodes: readonly string[] }[] = []
      const walk = (children: readonly unknown[]) => {
        for (const child of children as Array<Record<string, unknown>>) {
          if (Array.isArray(child.children)) walk(child.children)
          else if (typeof child.href === 'string')
            out.push({ href: child.href, menuCodes: child.menuCodes as string[] })
        }
      }
      walk(ADMIN_NAV_GROUPS)
      return out
    }

    it('每个模块都声明了非空 menuCodes', () => {
      for (const m of Object.values(GEOGRAPHY_MODULES)) {
        if (!m) continue
        expect(m.menuCodes.length, `${m.route} 缺少 menuCodes`).toBeGreaterThan(0)
      }
    })

    it('模块 menuCodes 与同 href 的导航叶子完全相同', () => {
      const leaves = allLeaves()
      for (const m of Object.values(GEOGRAPHY_MODULES)) {
        if (!m) continue
        const leaf = leaves.find((l) => l.href === `/admin${m.route}`)
        expect(leaf, `导航里找不到 /admin${m.route}`).toBeDefined()
        expect([...m.menuCodes].sort()).toEqual([...leaf!.menuCodes].sort())
      }
    })

    it('menuCodes 全部是合法的 MENU_CODES 成员', () => {
      for (const m of Object.values(GEOGRAPHY_MODULES)) {
        if (!m) continue
        for (const code of m.menuCodes) {
          expect(MENU_CODES as readonly string[]).toContain(code)
        }
      }
    })
  })
})