/**
 * 词表型筛选取值的收口守卫。
 *
 * 起因（2026-09-08 线上复现）：
 * `/shanghai/listings?district=not-a-real-district` 会在筛选 chip 上印出
 * 「位置：not-a-real-district」、在空态②印出「取消『位置：not-a-real-district』
 * 这一个条件」——URL 上一段任意输入被当成行政区的名字展示给用户。根因是
 * `districts.find((d) => d.slug === v)?.name ?? v` 这一类**回落成原始取值**的写法，
 * 房源页的 district、楼盘页的 district / metro / grade 各有一份。
 *
 * 本文件把两条规则钉死：
 *   1. **任何词表型维度的文案都不得出现 URL 原始取值**（`q` 除外——它是自由文本，
 *      取值本身就是内容）。这一条是逐维度全量扫的，新增维度时漏了会红。
 *   2. **查不到名称的取值不能继续悄悄筛**：能判定「不存在」的（房源页区域走路由层
 *      词表、楼盘页区域/地铁走查询层全城 facet、等级走解析层静态白名单）一律丢弃，
 *      判定不了的（房源页 metro / businessArea，本页从不加载那两张名表）保留过滤但
 *      不回显取值，且必须仍然是一个**可见可清除**的条件（`active: true`）。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  buildBuildingCanonicalParams,
  buildCanonicalSearchParams,
  parseBuildingSearchInput,
  parseListingSearchInput,
  withKnownBuildingVocabulary,
} from '@/domain/public-catalog'
import { buildBuildingFilterRows } from '@/lib/frontend/building-filter-rows'
import { buildListingFilterDimensions } from '@/lib/frontend/listing-filter-rows'
import { dimensionPickText, keepKnownValues, vocabularyName } from '@/lib/frontend/filter-dimension'

/** 复现用的敌意取值：既不是任何区域 slug，也不是任何枚举值。 */
const HOSTILE = 'not-a-real-district'

const SHANGHAI_DISTRICTS = [
  { id: 1, slug: 'jingan', name: '静安' },
  { id: 2, slug: 'xuhui', name: '徐汇' },
] as const

describe('filter-dimension：词表查不到就返回 null，绝不回落成原始取值', () => {
  it('vocabularyName 查得到给名称，查不到给 null', () => {
    expect(vocabularyName('jingan', SHANGHAI_DISTRICTS)).toBe('静安')
    expect(vocabularyName(HOSTILE, SHANGHAI_DISTRICTS)).toBeNull()
    expect(vocabularyName(undefined, SHANGHAI_DISTRICTS)).toBeNull()
  })

  it('dimensionPickText 在 null 时只印维度名（条件仍可见可清除，只是没有名字）', () => {
    expect(dimensionPickText('位置', '静安')).toBe('位置：静安')
    expect(dimensionPickText('地铁', null)).toBe('地铁')
  })

  it('keepKnownValues 全部落选时返回 undefined（= 维度未生效），不返回空数组', () => {
    const known = new Set(['jingan', 'xuhui'])
    expect(keepKnownValues(['jingan', HOSTILE], known)).toEqual(['jingan'])
    expect(keepKnownValues([HOSTILE], known)).toBeUndefined()
    expect(keepKnownValues(undefined, known)).toBeUndefined()
  })
})

describe('房源列表：未知区域不再被当成条件名展示', () => {
  const dimensionsFor = (query: string) =>
    buildListingFilterDimensions({
      input: parseListingSearchInput(new URLSearchParams(query)),
      districts: SHANGHAI_DISTRICTS as unknown as Parameters<
        typeof buildListingFilterDimensions
      >[0]['districts'],
      priceDimensionLabel: '租金',
    })

  it('已知区域仍然显示中文名（正常路径不受影响）', () => {
    const district = dimensionsFor('?district=jingan').find((d) => d.dimension === 'district')!
    expect(district.active).toBe(true)
    expect(district.activeText).toBe('静安')
  })

  it('未知区域的 activeText 是 null，而不是原始取值', () => {
    const district = dimensionsFor(`?district=${HOSTILE}`).find((d) => d.dimension === 'district')!
    expect(district.activeText).toBeNull()
  })

  it('地铁 / 商圈永远不回显取值，但仍然是生效且可清除的条件', () => {
    // 这两个维度是「词表型却拿不到词表」的一类：本页从不加载地铁站 / 商圈名表，
    // 因此判定不了取值存不存在——不能替用户把一个真的在收窄结果集的条件丢掉，
    // 只能不印取值。旧实现把 slug 直接当名字印出「地铁：jingansi」，合法值非法值一律如此。
    const dimensions = dimensionsFor(`?metro=${HOSTILE}&businessArea=${HOSTILE}`)
    for (const name of ['metro', 'businessArea'] as const) {
      const dimension = dimensions.find((d) => d.dimension === name)!
      expect(dimension.active, `${name} 必须仍算生效，否则会变成看不见的生效条件`).toBe(true)
      expect(dimension.activeText).toBeNull()
    }
  })

  it('关键词是自由文本，照旧原样回显（不适用词表规则）', () => {
    const q = dimensionsFor('?q=整层').find((d) => d.dimension === 'q')!
    expect(q.active).toBe(true)
    expect(q.activeText).toBe('整层')
  })

  it('全量覆盖：把敌意取值塞进每一个字符串维度，没有任何文案带上它', () => {
    const query =
      `?district=${HOSTILE}&type=${HOSTILE}&businessArea=${HOSTILE}&metro=${HOSTILE}` +
      `&availableBefore=${HOSTILE}&priceUnit=${HOSTILE}&sort=${HOSTILE}`
    for (const dimension of dimensionsFor(query)) {
      expect(
        dimension.activeText ?? '',
        `维度 ${dimension.dimension} 把 URL 原始取值当成了条件文案`,
      ).not.toContain(HOSTILE)
      for (const text of Object.values(dimension.paramTexts ?? {})) {
        expect(text, `维度 ${dimension.dimension} 的逐键文案回显了原始取值`).not.toContain(HOSTILE)
      }
    }
  })
})

describe('房源列表路由层：未知区域从查询与 canonical 一起丢掉', () => {
  async function resolve(query: string, districts: readonly { slug: string }[]) {
    vi.resetModules()
    vi.doMock('@/lib/frontend/cached-queries', () => ({
      getCachedListingDistrictOptions: vi.fn(async () => districts),
    }))
    const { resolveListingSearchInput } = await import('@/app/(frontend)/_lib/listing-search-input')
    return resolveListingSearchInput('shanghai', new URLSearchParams(query))
  }

  it('未知区域被丢掉：既不进查询 input，也不进 canonical', async () => {
    const input = await resolve(`?district=${HOSTILE}`, SHANGHAI_DISTRICTS)
    expect(input.district).toBeUndefined()
    expect(buildCanonicalSearchParams(input).toString()).not.toContain(HOSTILE)
  })

  it('已知区域原样保留（正常筛选不受影响）', async () => {
    const input = await resolve('?district=jingan', SHANGHAI_DISTRICTS)
    expect(input.district).toEqual(['jingan'])
    expect(buildCanonicalSearchParams(input).toString()).toContain('district=jingan')
  })

  it('混着来时只留已知的那些', async () => {
    const input = await resolve(`?district=jingan&district=${HOSTILE}`, SHANGHAI_DISTRICTS)
    expect(input.district).toEqual(['jingan'])
  })

  it('没有区域筛选时不去取区域词表（保住路由层的并发取数）', async () => {
    vi.resetModules()
    const getCachedListingDistrictOptions = vi.fn(async () => SHANGHAI_DISTRICTS)
    vi.doMock('@/lib/frontend/cached-queries', () => ({ getCachedListingDistrictOptions }))
    const { resolveListingSearchInput } = await import('@/app/(frontend)/_lib/listing-search-input')
    await resolveListingSearchInput('shanghai', new URLSearchParams('?q=整层'))
    expect(getCachedListingDistrictOptions).not.toHaveBeenCalled()
  })
})

describe('楼盘列表：同一类回落在三个维度上一起收口', () => {
  const FACETS = {
    districts: [{ slug: 'jingan', name: '静安', count: 3 }],
    grades: [{ value: 'grade-a', count: 3 }],
    metros: [{ slug: 'jingansi', name: '静安寺', count: 3 }],
  }

  const dimensionsFor = (query: string) =>
    buildBuildingFilterRows({ input: parseBuildingSearchInput(new URLSearchParams(query)), facets: FACETS })
      .dimensions

  it('已知取值仍然显示中文名', () => {
    const dimensions = dimensionsFor('?district=jingan&metro=jingansi&grade=grade-a')
    expect(dimensions.find((d) => d.dimension === 'district')!.activeText).toBe('静安')
    expect(dimensions.find((d) => d.dimension === 'metro')!.activeText).toBe('静安寺')
    expect(dimensions.find((d) => d.dimension === 'grade')!.activeText).toBe('甲级')
  })

  it('全量覆盖：敌意取值不出现在任何维度文案里', () => {
    const query = `?district=${HOSTILE}&metro=${HOSTILE}&grade=${HOSTILE}&sort=${HOSTILE}`
    for (const dimension of dimensionsFor(query)) {
      expect(
        dimension.activeText ?? '',
        `维度 ${dimension.dimension} 把 URL 原始取值当成了条件文案`,
      ).not.toContain(HOSTILE)
    }
  })

  it('未知等级在解析层就被丢掉（静态词表，不必等到查询层）', () => {
    const input = parseBuildingSearchInput(new URLSearchParams(`?grade=${HOSTILE}`))
    expect(input.grade).toBeUndefined()
    expect(buildBuildingCanonicalParams(input).toString()).not.toContain(HOSTILE)
  })

  it('合法等级照旧解析', () => {
    expect(parseBuildingSearchInput(new URLSearchParams('?grade=grade-a')).grade).toEqual(['grade-a'])
  })

  it('withKnownBuildingVocabulary 丢掉本城不存在的区域 / 地铁，保留存在的', () => {
    const input = parseBuildingSearchInput(
      new URLSearchParams(`?district=jingan&district=${HOSTILE}&metro=${HOSTILE}`),
    )
    const applied = withKnownBuildingVocabulary(input, FACETS)
    expect(applied.district).toEqual(['jingan'])
    expect(applied.metro).toBeUndefined()
    expect(buildBuildingCanonicalParams(applied).toString()).not.toContain(HOSTILE)
  })

  it('判据是全城全集，不是当前筛选后的子集（否则真实存在的区会被当成不存在丢掉）', () => {
    // `searchBuildingsFiltered` 传进来的必须是 `buildBuildingFacets(allDocs)`：
    // 用剥离后的子集当词表，「静安 + 甲级 一个都不剩」会让静安自己从词表里消失。
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan'))
    expect(withKnownBuildingVocabulary(input, { districts: [], metros: [] }).district).toBeUndefined()
    expect(withKnownBuildingVocabulary(input, FACETS).district).toEqual(['jingan'])
  })
})
