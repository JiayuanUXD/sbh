import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LocationPanel from '@/components/frontend/LocationPanel'
import type { NearbyPoi } from '@/domain/location-services'
import type { PoiByCategory } from '@/lib/frontend/location-pois'

/**
 * 终审 I1：交通子分类的初值不能写死 `'subway'`。
 *
 * 「有交通 POI」不等于「有地铁 POI」。只有公交站没有地铁站的楼盘：交通 tab 显示
 * 「交通（N）」并选中 → 按 subway 过滤后为空 → 而子 tab 需要 `> 1` 种子分类才渲染，
 * 用户连切过去的入口都没有 → 清单整块不渲染，计数说 N、列表空白。OPT-037 Task 5
 * 把 `mapPois` 从「交通类恒画全量 subway+bus」改成 `mapPois = activePois` 之后，
 * 地图图钉也跟着归零——改造前至少还画着那 N 个公交图钉，属改造引入的放大。
 *
 * 断言落在**渲染出来的清单条目**上（POI 名称与字母锚点），而不是内部 state：
 * 用户看得见的是列表有没有内容。
 */

const BUILDING = {
  id: 1,
  name: '静安中心',
  address: '上海市静安区南京西路 1515 号',
  coordinates: { latitude: 31.2266, longitude: 121.4554 },
}

function poi(overrides: Partial<NearbyPoi> & Pick<NearbyPoi, 'id' | 'name'>): NearbyPoi {
  return {
    category: 'transport',
    coordinates: { latitude: 31.2266, longitude: 121.4554 },
    distanceMeters: 260,
    direction: '东',
    source: 'amap-location-service',
    fetchedAt: '2026-08-22T00:00:00.000Z',
    subCategory: null,
    metroLines: [],
    ...overrides,
  }
}

function poiSet(transport: readonly NearbyPoi[]): PoiByCategory {
  return { transport, restaurant: [], bank: [], hotel: [] }
}

function render(pois: PoiByCategory): string {
  return renderToStaticMarkup(
    createElement(LocationPanel, { building: BUILDING, pois, mapEnabled: false }),
  )
}

describe('LocationPanel 交通子分类', () => {
  it('只有公交没有地铁时，清单展示公交站而不是一片空白', () => {
    const html = render(
      poiSet([
        poi({ id: 'bus-1', name: '南京西路石门一路站', subCategory: 'bus' }),
        poi({ id: 'bus-2', name: '成都北路站', subCategory: 'bus' }),
      ]),
    )

    expect(html).toContain('交通（2）')
    expect(html).toContain('南京西路石门一路站')
    expect(html).toContain('成都北路站')
  })

  it('两种子分类都有时仍默认选中地铁（不改变既有默认）', () => {
    const html = render(
      poiSet([
        poi({ id: 'subway-1', name: '南京西路站', subCategory: 'subway' }),
        poi({ id: 'bus-1', name: '成都北路站', subCategory: 'bus' }),
      ]),
    )

    // 两种子分类 → 子 tab 渲染，用户可自行切换
    expect(html).toContain('地铁（1）')
    expect(html).toContain('公交（1）')
    // 默认清单是地铁那一支
    expect(html).toContain('南京西路站')
    expect(html).not.toContain('成都北路站')
  })

  it('只有地铁没有公交时行为不变', () => {
    const html = render(poiSet([poi({ id: 'subway-1', name: '南京西路站', subCategory: 'subway' })]))
    expect(html).toContain('南京西路站')
  })
})
