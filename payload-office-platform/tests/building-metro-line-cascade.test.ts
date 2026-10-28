import { describe, expect, it } from 'vitest'
import {
  applyBuildingFilters,
  buildBuildingCanonicalParams,
  BUILDING_DIMENSION_PARAM_KEYS,
  omitBuildingSearchDimensions,
  parseBuildingSearchInput,
} from '@/domain/public-catalog/building-search'
import { buildBuildingPageQuery } from '@/domain/public-catalog/building-query-sql'
import { mapMetroStation } from '@/domain/public-catalog/mappers'
import { createSearchContext } from '@/domain/public-catalog/types'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { buildBuildingFilterRows, type BuildingFacets } from '@/lib/frontend/building-filter-rows'

/**
 * 地铁筛选由「一行上百个站」改成「线路 → 站点」两级，级联闸门与商圈同型。
 * 站点从属于线路（换乘站只存一条、归首开线路）；URL：`?metroLine=<线路>` + `?metro=<站点>`。
 */

const base = { sort: 'stock-desc', page: 1, pageSize: 24 } as const

const b = (slug: string, station?: { slug: string; line?: string }): BuildingSummaryViewModel =>
  ({
    id: 1, slug, name: slug, address: 'addr', citySlug: 'shanghai', cityName: '上海',
    ...(station
      ? { nearestMetro: { id: 9, slug: station.slug, name: station.slug, ...(station.line ? { line: { slug: station.line, name: station.line } } : {}) } }
      : {}),
  }) as BuildingSummaryViewModel

describe('解析 / canonical：metroLine', () => {
  it('解析为去重数组，canonical 排序输出，线路排在站点之前', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?metro=jingansi&metroLine=line-2&metroLine=line-1&metroLine=line-2'))
    expect(input.metroLine).toEqual(['line-2', 'line-1'])
    expect(buildBuildingCanonicalParams(input).toString()).toBe('metroLine=line-1&metroLine=line-2&metro=jingansi')
  })

  it('缺省与空值不进 canonical；老链接 ?metro=<站点> 原样保留', () => {
    expect(buildBuildingCanonicalParams(parseBuildingSearchInput(new URLSearchParams('?metroLine='))).toString()).toBe('')
    expect(buildBuildingCanonicalParams(parseBuildingSearchInput(new URLSearchParams('?metro=jingansi'))).toString()).toBe('metro=jingansi')
  })
})

describe('维度清单：线路与站点同属 metro 维度', () => {
  it('占两个 URL 键，omit 一次删两个（取消地铁 / 清除全部不会留半截）', () => {
    expect(BUILDING_DIMENSION_PARAM_KEYS.metro).toEqual(['metro', 'metroLine'])
    const input = parseBuildingSearchInput(new URLSearchParams('?metroLine=line-2&metro=jingansi&grade=grade-a'))
    const next = omitBuildingSearchDimensions(input, ['metro'])
    expect(next.metro).toBeUndefined()
    expect(next.metroLine).toBeUndefined()
    expect(next.grade).toEqual(['grade-a'])
  })
})

describe('applyBuildingFilters：metroLine', () => {
  const docs = [
    b('a', { slug: 'jingansi', line: 'line-2' }),
    b('b', { slug: 'renmin', line: 'line-1' }),
    b('c', { slug: 'unknown-line' }),
    b('d'),
  ]
  const slugs = (input: object) => applyBuildingFilters(docs, { ...base, ...input }).map((d) => d.slug)

  it('按站点所属线路命中；线路未知或没有最近地铁的楼盘不命中（缺失 ≠ 任意）', () => {
    expect(slugs({ metroLine: ['line-2'] })).toEqual(['a'])
    expect(slugs({ metroLine: ['line-1', 'line-2'] })).toEqual(['a', 'b'])
  })

  it('选了站点就以站点为准，不一致的线路条件被忽略（不会拼出恒空组合）', () => {
    expect(slugs({ metro: ['jingansi'], metroLine: ['line-1'] })).toEqual(['a'])
  })
})

describe('筛选行：线路 → 站点级联', () => {
  const FACETS: BuildingFacets = {
    districts: [],
    businessAreas: [],
    grades: [],
    metroLines: [
      { slug: 'line-10', name: '10号线', count: 3 },
      { slug: 'line-2', name: '2号线', count: 5 },
      { slug: 'line-1', name: '1号线', count: 4 },
      { slug: 'line-9', name: '9号线', count: 0 },
    ],
    metros: [
      { slug: 'jingansi', name: '静安寺', count: 2, lineSlug: 'line-2' },
      { slug: 'lujiazui', name: '陆家嘴', count: 3, lineSlug: 'line-2' },
      { slug: 'renmin', name: '人民广场', count: 4, lineSlug: 'line-1' },
      { slug: 'empty', name: '空站', count: 0, lineSlug: 'line-2' },
    ],
  }
  const rowsFor = (query: string) =>
    buildBuildingFilterRows({ input: parseBuildingSearchInput(new URLSearchParams(query)), facets: FACETS })
  const row = (query: string, key: string) => rowsFor(query).rows.find((r) => r.key === key)!

  it('未选线路：「地铁」行列线路（自然序 1 < 2 < 10，计数 0 的不渲染），站点行为空', () => {
    expect(row('', 'metroLine').options.map((o) => o.value)).toEqual(['line-1', 'line-2', 'line-10'])
    expect(row('', 'metro').options).toEqual([])
    expect(row('', 'metroLine').label).toBe('地铁')
    expect(row('', 'metro').label).toBe('站点')
  })

  it('选了线路：站点行只列该线路下计数 > 0 的站点', () => {
    expect(row('?metroLine=line-2', 'metro').options.map((o) => o.value)).toEqual(['jingansi', 'lujiazui'])
    expect(row('?metroLine=line-2', 'metroLine').activeValue).toBe('line-2')
  })

  it('换线 / 清线连站点一起清', () => {
    expect(row('', 'metroLine').clearsKeys).toEqual(['metro'])
  })

  it('老链接 ?metro=<站点>：线路由站点反推并高亮，站点行同时展开', () => {
    expect(row('?metro=renmin', 'metroLine').activeValue).toBe('line-1')
    expect(row('?metro=renmin', 'metro').options.map((o) => o.value)).toEqual(['renmin'])
    expect(row('?metro=renmin', 'metro').activeValue).toBe('renmin')
  })

  it('URL 上线路与站点不一致时站点说了算', () => {
    expect(row('?metroLine=line-1&metro=jingansi', 'metroLine').activeValue).toBe('line-2')
  })

  it('已选项即使计数为 0 也保留', () => {
    expect(row('?metroLine=line-9', 'metroLine').options.map((o) => o.value)).toContain('line-9')
  })

  it('站点叫不出名字（不在候选里）：站点行不渲染，条件仍然生效、不回显原始取值', () => {
    const { rows, dimensions } = rowsFor('?metro=not-a-station')
    expect(rows.find((r) => r.key === 'metro')!.options).toEqual([])
    const dim = dimensions.find((d) => d.dimension === 'metro')!
    expect(dim.active).toBe(true)
    expect(dim.activeText).toBeNull()
  })

  it('metro 维度：只选线路说线路名，选了站点说站点名，两个 URL 键都归它', () => {
    const lineOnly = rowsFor('?metroLine=line-2').dimensions.find((d) => d.dimension === 'metro')!
    expect(lineOnly.active).toBe(true)
    expect(lineOnly.activeText).toBe('2号线')
    expect(lineOnly.paramKeys).toEqual(['metro', 'metroLine'])
    const station = rowsFor('?metroLine=line-2&metro=jingansi').dimensions.find((d) => d.dimension === 'metro')!
    expect(station.activeText).toBe('静安寺')
  })
})

describe('mapMetroStation', () => {
  const station = { id: 5, slug: 'jingansi', name: '静安寺', type: 'metro_station' }
  it('parent 已展开且是线路：带上 line', () => {
    expect(mapMetroStation({ ...station, parent: { id: 2, slug: 'line-2', name: '2号线', type: 'metro_line' } })).toEqual({
      id: 5, slug: 'jingansi', name: '静安寺', line: { slug: 'line-2', name: '2号线' },
    })
  })
  it('parent 只是 id、或不是线路：没有 line', () => {
    expect(mapMetroStation({ ...station, parent: 2 })).toEqual({ id: 5, slug: 'jingansi', name: '静安寺' })
    expect(mapMetroStation({ ...station, parent: { id: 3, slug: 'x', name: 'x', type: 'city' } })).toEqual({ id: 5, slug: 'jingansi', name: '静安寺' })
    expect(mapMetroStation(undefined)).toBeUndefined()
  })
})

describe('楼盘数据库查询：线路', () => {
  const ctx = createSearchContext('shanghai')
  const query = (input: object) => buildBuildingPageQuery({ ...base, ...input }, ctx, [1])

  it('关联线路并输出线路 / 站点两路分面；线路值走绑定参数', () => {
    const q = query({ metroLine: ["line-2' OR 1=1--"] })
    expect(q.text).toContain("LEFT JOIN locations mline ON mline.id = metro.parent_id AND mline.type = 'metro_line'")
    expect(q.text).toContain("'metroLines'")
    expect(q.text).toContain("'lineSlug', extra_slug")
    expect(q.text).not.toContain("line-2' OR 1=1--")
    expect(q.values).toContainEqual(["line-2' OR 1=1--"])
    expect(q.text).toContain('line_slug = ANY(')
  })

  it('选了站点时命中集合只看站点（站点优先，与内存路径一致）；线路仍用于站点候选的收窄', () => {
    const q = query({ metro: ['jingansi'], metroLine: ['line-2'] })
    const matched = q.text.slice(q.text.indexOf('matched AS MATERIALIZED'), q.text.indexOf('selected AS MATERIALIZED'))
    expect(matched).toContain('metro_slug = ANY(')
    expect(matched).not.toContain('line_slug = ANY(')
    expect(q.text).toContain('line_slug = ANY(')
  })
})
