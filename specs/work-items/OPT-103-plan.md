# OPT-103 列表页筛选瘦身 + 共享办公独立频道 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个列表页各减一行控件、楼盘页补商圈行、筛选底栏不再报数；共享办公升格为 `/[city]/coworking` 独立频道，导航零迁移改指新频道。规格：`specs/work-items/OPT-103-list-filter-slim-coworking-channel.md`。

**Architecture:** 域层先补楼盘 `businessArea` 维度（解析 / canonical / 过滤 / facet / omit），编排层再接商圈行并删开关；`FilterFormC` 家族删计数与开关型行；`CityListingsView` 的 `businessType` 泛化为 `channel`（lease / sale / coworking），coworking 由路由层锁定类型、canonical 剥 `type`；导航目标 `listings-type-coworking` 只改 href。

**Tech Stack:** Next.js 16 App Router（Server Components）、Payload 3.86、vitest、Playwright。

## Global Constraints

- 工作树 `E:\wt-lsopt`，分支 `feat/opt-103-list-filter-slim-694d`；所有命令在 `E:\wt-lsopt\payload-office-platform` 下跑。**不要在 master 上提交**。
- 提交只用显式 `git add <路径>`，禁 `git add -A` / `-am`。提交信息类型前缀 `feat` / `refactor` / `test` / `docs`，简体中文。
- 禁 `any` / `as any` / `@ts-ignore`；外部输入 `unknown` 收口。
- 不做 schema 变更、不新增迁移；`src/collections/` 与 `src/globals/` 一个文件都不动（pre-commit 迁移闸门按路径拦）。
- 文案：楼盘量词「个楼盘」，房源「套」；共享办公频道标题「{城市}共享办公」，主语「共享办公房源」。
- 单测跑法：`pnpm vitest run tests/<file>.test.ts`；typecheck：`pnpm typecheck`；全量：`pnpm test`。
- 词表型维度**绝不回显 URL 原始取值**（`vocabularyName` 查不到即 `null`，chip 只印维度名）。
- 「生效条件必须可见可清除」：任何进 URL 且真的收窄结果集的条件，要么有筛选行显示，要么由编排层补 `extraPicks` chip。

---

### Task 1: 域层 —— 楼盘搜索加 `businessArea` 维度

**Files:**
- Modify: `src/domain/public-catalog/building-search.ts`（`BuildingSearchInput` / `parseBuildingSearchInput` / `buildBuildingCanonicalParams` / `applyBuildingFilters` / `BuildingSearchDimension` / `BUILDING_CLEARABLE_DIMENSIONS` / `BUILDING_DIMENSION_PARAM_KEYS` / `omitBuildingSearchDimensions`）
- Modify: `src/domain/public-catalog/contracts.ts:133-145`（`BuildingSummaryViewModel`）
- Modify: `src/domain/public-catalog/mappers.ts:465-495`（`mapBuildingSummary`）
- Modify: `src/domain/public-catalog/facade.ts:162-197, 467-493, 512-575`（`BuildingFilteredResult.facets` / `buildBuildingFacets` / `searchBuildingsFiltered`）
- Test: `tests/building-search-business-area.test.ts`（新）

**Interfaces:**
- Produces: `BuildingSearchInput.businessArea?: readonly string[]`；`BuildingSearchDimension` 含 `'businessArea'`；`BUILDING_DIMENSION_PARAM_KEYS.businessArea === ['businessArea']`；`BuildingFilteredResult.facets.businessAreas: ReadonlyArray<{ slug; name; count }>`；`dimensionHits.businessArea: number`；`BuildingSummaryViewModel.businessDistrict?: DistrictViewModel`。

- [ ] **Step 1: 写失败测试**

`tests/building-search-business-area.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  applyBuildingFilters,
  buildBuildingCanonicalParams,
  BUILDING_CLEARABLE_DIMENSIONS,
  BUILDING_DIMENSION_PARAM_KEYS,
  omitBuildingSearchDimensions,
  parseBuildingSearchInput,
} from '@/domain/public-catalog/building-search'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { createSearchContext, searchBuildingsFiltered } from '@/domain/public-catalog'
import type { Location } from '@/payload-types'
import { DISTRICT_JINGAN, makeArea, makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'

/**
 * OPT-103：楼盘列表补「商圈」维度，口径逐字对齐房源页（OPT-099）。
 * 这里锁三件事：解析/canonical 的往返、内存过滤的命中判据、facet 的剥离口径。
 */

const b = (over: Partial<BuildingSummaryViewModel> & { slug: string }): BuildingSummaryViewModel =>
  ({ id: 1, name: over.slug, address: 'addr', citySlug: 'shanghai', cityName: '上海', ...over }) as BuildingSummaryViewModel

describe('parseBuildingSearchInput / buildBuildingCanonicalParams：businessArea', () => {
  it('解析为去重数组，canonical 排序后输出、位置紧跟 district', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan&businessArea=nanjing-xi-lu&businessArea=jingan-temple&businessArea=nanjing-xi-lu'))
    expect(input.businessArea).toEqual(['nanjing-xi-lu', 'jingan-temple'])
    expect(buildBuildingCanonicalParams(input).toString()).toBe(
      'district=jingan&businessArea=jingan-temple&businessArea=nanjing-xi-lu',
    )
  })

  it('缺省不进 canonical，空值丢弃', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?businessArea=&businessArea=%20'))
    expect(input.businessArea).toBeUndefined()
    expect(buildBuildingCanonicalParams(input).toString()).toBe('')
  })
})

describe('applyBuildingFilters：businessArea', () => {
  const docs = [
    b({ slug: 'a', businessDistrict: { id: 11, slug: 'nanjing-xi-lu', name: '南京西路' } }),
    b({ slug: 'b', businessDistrict: { id: 12, slug: 'jingan-temple', name: '静安寺' } }),
    b({ slug: 'c' }),
  ]

  it('按 businessDistrict.slug 命中，多值取并集', () => {
    expect(applyBuildingFilters(docs, { businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['a'])
    expect(applyBuildingFilters(docs, { businessArea: ['nanjing-xi-lu', 'jingan-temple'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['a', 'b'])
  })

  it('没有商圈的楼盘在任何商圈条件下都不命中（缺失 ≠ 任意）', () => {
    expect(applyBuildingFilters(docs, { businessArea: ['jingan-temple'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['b'])
  })
})

describe('维度清单', () => {
  it('businessArea 是可清除维度，占 URL 键 businessArea，omit 只删它', () => {
    expect(BUILDING_CLEARABLE_DIMENSIONS).toContain('businessArea')
    expect(BUILDING_DIMENSION_PARAM_KEYS.businessArea).toEqual(['businessArea'])
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan&businessArea=x&grade=grade-a'))
    const omitted = omitBuildingSearchDimensions(input, ['businessArea'])
    expect(omitted.businessArea).toBeUndefined()
    expect(omitted.district).toEqual(['jingan'])
    expect(omitted.grade).toEqual(['grade-a'])
  })
})

describe('searchBuildingsFiltered：商圈 facet 与级联', () => {
  const DISTRICT_HUANGPU: Location = { ...DISTRICT_JINGAN, id: 2, name: '黄浦', slug: 'huangpu', immutableCode: 'TEST-2' }
  const AREA_NJXL = makeArea({ id: 11, slug: 'nanjing-xi-lu', name: '南京西路' })
  const AREA_TEMPLE = makeArea({ id: 12, slug: 'jingan-temple', name: '静安寺' })
  const AREA_BUND = makeArea({ id: 21, slug: 'bund', name: '外滩', parent: DISTRICT_HUANGPU.id })
  const raws = [
    makeBuilding({ id: 1, slug: 'b1', district: DISTRICT_JINGAN, businessDistrict: AREA_NJXL }),
    makeBuilding({ id: 2, slug: 'b2', district: DISTRICT_JINGAN, businessDistrict: AREA_TEMPLE }),
    makeBuilding({ id: 3, slug: 'b3', district: DISTRICT_HUANGPU, businessDistrict: AREA_BUND }),
  ]
  const adapter = makeHomepageAdapter({ findEffectiveBuildings: async () => raws })
  const ctx = createSearchContext('shanghai', new Date('2026-09-19T00:00:00Z'))

  it('businessAreas 计数剥掉商圈、保留 district：选了静安只见静安的两个商圈各 1', async () => {
    const result = await searchBuildingsFiltered({ district: ['jingan'], businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, adapter)
    expect(result.docs.map((d) => d.slug)).toEqual(['b1'])
    const areas = new Map(result.facets.businessAreas.map((a) => [a.slug, a.count]))
    expect(areas.get('nanjing-xi-lu')).toBe(1)
    expect(areas.get('jingan-temple')).toBe(1)
    // 清单取自全集：外滩仍在清单里，只是计数 0（视图层按「不显示 0」丢）
    expect(areas.get('bund')).toBe(0)
    expect(result.facets.businessAreas.find((a) => a.slug === 'jingan-temple')?.name).toBe('静安寺')
  })

  it('districts 计数连商圈一起剥：选了商圈后其余区不归零，用户切得走', async () => {
    const result = await searchBuildingsFiltered({ district: ['jingan'], businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, adapter)
    const districts = new Map(result.facets.districts.map((d) => [d.slug, d.count]))
    expect(districts.get('jingan')).toBe(2)
    expect(districts.get('huangpu')).toBe(1)
    expect(result.dimensionHits.businessArea).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/building-search-business-area.test.ts`
Expected: FAIL（`businessArea` 未解析、`facets.businessAreas` undefined、`applyBuildingFilters` 不过滤）。

- [ ] **Step 3: 改 `building-search.ts`**

`BuildingSearchInput` 在 `district` 之后加：

```ts
  district?: readonly string[]
  /** 商圈（OPT-103）：从属于行政区，口径同房源页 `ListingSearchInput.businessArea`。 */
  businessArea?: readonly string[]
```

`parseBuildingSearchInput`：在 `const district = ...` 之后加 `const businessArea = parseDedupedStringArray(sp, 'businessArea')`，返回对象里 `...(district ? { district } : {}),` 之后加 `...(businessArea ? { businessArea } : {}),`。

`buildBuildingCanonicalParams`：在 district 那行之后加
```ts
  if (input.businessArea) for (const v of [...input.businessArea].sort()) sp.append('businessArea', v)
```

`applyBuildingFilters`：在 `const districtSet` 之后加 `const businessAreaSet = input.businessArea ? new Set(input.businessArea) : null`；过滤体第一行 district 判断之后加：
```ts
    if (businessAreaSet && (!doc.businessDistrict || !businessAreaSet.has(doc.businessDistrict.slug))) return false
```

`BuildingSearchDimension` 联合类型在 `'district'` 之后加 `| 'businessArea'`；`BUILDING_CLEARABLE_DIMENSIONS` 在 `'district'` 之后加 `'businessArea'`；`BUILDING_DIMENSION_PARAM_KEYS` 加 `businessArea: ['businessArea'],`；`omitBuildingSearchDimensions` 加 `if (drop.has('businessArea')) delete next.businessArea`。顶部「六个维度」相关注释改成「七个维度」（`BUILDING_CLEARABLE_DIMENSIONS` 与 `omitBuildingSearchDimensions` 两处注释）。

- [ ] **Step 4: 改 `contracts.ts` / `mappers.ts`**

`BuildingSummaryViewModel` 在 `district?: DistrictViewModel` 之后加：
```ts
  /** 商圈（OPT-103 楼盘列表商圈筛选）；扫描本就 depth 2，零额外查询。 */
  businessDistrict?: DistrictViewModel
```

`mapBuildingSummary` 返回对象在 `district: mapDistrict(districtRaw),` 之后加 `businessDistrict: mapDistrict(populated?.businessDistrict),`。

- [ ] **Step 5: 改 `facade.ts`**

`BuildingFilteredResult.facets` 加一行：
```ts
    businessAreas: ReadonlyArray<{ slug: string; name: string; count: number }>
```

`buildBuildingFacets` 加一个 `businessAreas` Map，循环里：
```ts
    if (doc.businessDistrict) {
      const entry = businessAreas.get(doc.businessDistrict.slug)
      businessAreas.set(doc.businessDistrict.slug, { name: doc.businessDistrict.name, count: (entry?.count ?? 0) + 1 })
    }
```
返回里加 `businessAreas: Array.from(businessAreas.entries()).map(([slug, { name, count }]) => ({ slug, name, count })),`。

`searchBuildingsFiltered`：`facetsOf` 的参数类型扩成 `'district' | 'grade' | 'metro' | 'businessArea'`；`facets` 改为：
```ts
  // ★ 区域候选**连商圈一起剥**（OPT-099 房源页走查实测的同型问题）：只剥 district 的话，
  // 一旦选了某个商圈，其余区计数全 0（那个商圈只属于当前这个区），「位置」行塌成只剩
  // 已选的那一个区，用户再也切不走。商圈候选只剥 businessArea——district 留着，级联正是靠它成立。
  const districtsWithoutArea = applyBuildingFilters(allDocs, omitBuildingSearchDimensions(input, ['district', 'businessArea']))
  const facets = {
    districts: overlay(allFacets.districts, buildBuildingFacets(districtsWithoutArea).districts, (d) => d.slug),
    businessAreas: overlay(allFacets.businessAreas, facetsOf('businessArea').businessAreas, (a) => a.slug),
    grades: overlay(allFacets.grades, facetsOf('grade').grades, (g) => g.value),
    metros: overlay(allFacets.metros, facetsOf('metro').metros, (m) => m.slug),
  }
  const dimensionHits = {
    district: hitsOf('district'),
    businessArea: hitsOf('businessArea'),
    grade: hitsOf('grade'),
    metro: hitsOf('metro'),
    leasableArea: hitsOf('leasableArea'),
    completedAfter: hitsOf('completedAfter'),
    onlyWithStock: hitsOf('onlyWithStock'),
  }
```
（`omitBuildingSearchDimensions` 已在该文件导入，确认 import 存在。）

- [ ] **Step 6: 跑测试**

Run: `pnpm vitest run tests/building-search-business-area.test.ts tests/opt036-building-search.test.ts tests/opt036-building-search-result.test.ts && pnpm typecheck`
Expected: 全 PASS；typecheck 会在 `building-filter-rows.ts` 报 `dimensionHits`/facets 形状缺 `businessArea` 之类的错——那是 Task 2 的事，**本步只要求域层三个测试文件绿**；若 typecheck 只报 `src/lib/frontend/building-filter-rows.ts` 与 `CityBuildingsView.tsx`，继续。

- [ ] **Step 7: 提交**

```bash
git add src/domain/public-catalog/building-search.ts src/domain/public-catalog/contracts.ts src/domain/public-catalog/mappers.ts src/domain/public-catalog/facade.ts tests/building-search-business-area.test.ts
git commit -m "feat(catalog): 楼盘搜索加 businessArea 维度（解析/canonical/过滤/facet/omit）"
```

---

### Task 2: 楼盘筛选行 —— 加商圈行、删开关维度声明

**Files:**
- Modify: `src/lib/frontend/building-filter-rows.ts`
- Modify: `tests/filter-unknown-vocabulary-values.test.ts:155-160`（`FACETS` 夹具补 `businessAreas`）
- Test: `tests/building-filter-rows.test.ts`（新）

**Interfaces:**
- Consumes: Task 1 的 `BuildingSearchInput.businessArea`、`facets.businessAreas`。
- Produces: `buildBuildingFilterRows` 的 `rows` 顺序 `district / businessArea / grade / metro / leasableAreaMin / completedAfter`；`BuildingFacets` 加 `businessAreas`；`dimensions` 含 `businessArea`（`label: '商圈'`），`onlyWithStock` 维度保留。

- [ ] **Step 1: 写失败测试**

`tests/building-filter-rows.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildBuildingFilterRows, type BuildingFacets } from '@/lib/frontend/building-filter-rows'
import { parseBuildingSearchInput } from '@/domain/public-catalog'

/** OPT-103：楼盘列表商圈行，级联口径逐字对齐房源页（listing-filter-rows.ts）。 */

const FACETS: BuildingFacets = {
  districts: [
    { slug: 'jingan', name: '静安', count: 2 },
    { slug: 'huangpu', name: '黄浦', count: 1 },
  ],
  businessAreas: [
    { slug: 'nanjing-xi-lu', name: '南京西路', count: 1 },
    { slug: 'jingan-temple', name: '静安寺', count: 1 },
    { slug: 'bund', name: '外滩', count: 0 },
  ],
  grades: [{ value: 'grade-a', count: 3 }],
  metros: [],
}

const rowsFor = (query: string) =>
  buildBuildingFilterRows({ input: parseBuildingSearchInput(new URLSearchParams(query)), facets: FACETS })

describe('楼盘筛选行：商圈', () => {
  it('行序：位置 → 商圈 → 等级 → 地铁 → 在租面积 → 竣工年代；没有开关行', () => {
    expect(rowsFor('').rows.map((r) => r.key)).toEqual([
      'district', 'businessArea', 'grade', 'metro', 'leasableAreaMin', 'completedAfter',
    ])
  })

  it('未选行政区时商圈候选为空（整行由 FilterFormC 隐藏）', () => {
    expect(rowsFor('').rows.find((r) => r.key === 'businessArea')!.options).toEqual([])
  })

  it('选了行政区后商圈候选出现，计数 0 的不渲染、已选的保留', () => {
    const row = rowsFor('?district=jingan&businessArea=bund').rows.find((r) => r.key === 'businessArea')!
    expect(row.options.map((o) => o.value)).toEqual(['nanjing-xi-lu', 'jingan-temple', 'bund'])
    expect(row.options.find((o) => o.value === 'bund')!.count).toBeUndefined()
    expect(row.activeValue).toBe('bund')
  })

  it('位置行级联清商圈', () => {
    expect(rowsFor('').rows.find((r) => r.key === 'district')!.clearsKeys).toEqual(['businessArea'])
  })

  it('商圈维度：有词表印名字，查不到只印维度名，绝不回显 slug', () => {
    const known = rowsFor('?district=jingan&businessArea=jingan-temple').dimensions.find((d) => d.dimension === 'businessArea')!
    expect(known.active).toBe(true)
    expect(known.activeText).toBe('静安寺')
    expect(known.paramKeys).toEqual(['businessArea'])
    const unknown = rowsFor('?businessArea=not-a-real-area').dimensions.find((d) => d.dimension === 'businessArea')!
    expect(unknown.active).toBe(true)
    expect(unknown.activeText).toBeNull()
  })

  it('onlyWithStock 维度仍在清单里（老链接 ?onlyWithStock=1 要能补 chip）', () => {
    const dim = rowsFor('?onlyWithStock=1').dimensions.find((d) => d.dimension === 'onlyWithStock')!
    expect(dim.active).toBe(true)
    expect(dim.activeText).toBe('仅看有在租')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/building-filter-rows.test.ts`
Expected: FAIL（行序缺 `businessArea`）。

- [ ] **Step 3: 改 `building-filter-rows.ts`**

`BuildingFacets` 加 `businessAreas: ReadonlyArray<{ slug: string; name: string; count: number }>`。

`buildBuildingFilterRows` 里：
```ts
  const activeBusinessArea = firstOrUndefined(input.businessArea)
  /**
   * 商圈候选（OPT-103，口径逐字对齐房源页 OPT-099）——**级联闸门在这里**。
   * 未选行政区时恒为空数组，`FilterFormC` 的「无候选值的行不渲染」规则会把整行隐藏：
   * 生产库 294 个商圈整城平铺进一条纯文本行放不下，先收窄到区再选商圈。
   * 计数为 0 的候选不渲染、当前已选项永远保留——与 districtOptions 同一口径。
   */
  const businessAreaOptions = activeDistrict
    ? facets.businessAreas
        .filter((a) => keepOption(a.count, a.slug === activeBusinessArea))
        .map((a) => ({ value: a.slug, label: a.name, ...(a.count > 0 ? { count: a.count } : {}) }))
    : []
```
`rows` 数组改为：
```ts
  const rows: FilterRow[] = [
    // 切区 / 清区连商圈一起清：商圈从属于行政区，留着上一个区的商圈就是「静安 + 陆家嘴」这种恒空组合。
    { key: 'district', label: '位置', options: districtOptions, clearsKeys: ['businessArea'], ...(activeDistrict ? { activeValue: activeDistrict } : {}) },
    { key: 'businessArea', label: '商圈', options: businessAreaOptions, ...(activeBusinessArea ? { activeValue: activeBusinessArea } : {}) },
    { key: 'grade', ... },  // 其余四行原样
```
`dimensions` 在 district 之后插入：
```ts
    {
      dimension: 'businessArea',
      label: '商圈',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.businessArea,
      active: activeBusinessArea != null,
      // 词表来自扫描行的 businessDistrict（facets.businessAreas 清单取自全集）；查不到只印维度名。
      activeText: vocabularyName(activeBusinessArea, facets.businessAreas),
    },
```
文件头注释「区域 · 等级 · 地铁 · 在租面积 · 竣工年代 · 仅看有在租（6）」改为「区域 · 商圈 · 等级 · 地铁 · 在租面积 · 竣工年代（6 行文本条件；『仅看有在租』开关已于 OPT-103 移除，`onlyWithStock` 维度保留给老链接补 chip）」。

- [ ] **Step 4: 补 `filter-unknown-vocabulary-values.test.ts` 夹具**

第 156-160 行 `FACETS` 加 `businessAreas: [{ slug: 'jingan-temple', name: '静安寺', count: 3 }],`；「全量覆盖」用例的 query 加 `&businessArea=${HOSTILE}`。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run tests/building-filter-rows.test.ts tests/filter-unknown-vocabulary-values.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/frontend/building-filter-rows.ts tests/building-filter-rows.test.ts tests/filter-unknown-vocabulary-values.test.ts
git commit -m "feat(frontend): 楼盘筛选行加商圈（级联口径同房源页）"
```

---

### Task 3: `FilterFormC` 家族 —— 删底栏计数与开关型行

**Files:**
- Modify: `src/components/frontend/listing/FilterFormC.tsx`
- Modify: `src/components/frontend/listing/MobileFilterSheet.tsx:7, 114-131, 205-250`
- Modify: `src/components/frontend/listing/MobileFilterShell.tsx:43-97`
- Modify: `src/app/(frontend)/styles/list.css:379-437, 904-927`
- Test: `tests/filter-form-c-footer.test.ts`（新）

**Interfaces:**
- Produces: `FilterFormC` props 变为 `{ rows, basePath, currentParams, clearAllHref, extraPicks? }`（**无** `totalCount` / `countNoun` / `switchRow`）；`countActivePicks(rows)` 单参；`FilterSwitch` 类型删除；`MobileFilterShell` / `MobileFilterSheet` 无 `switchRow` prop（`totalDocs` / `countNoun` 保留——抽屉底部「查看 N 套」CTA 用）。

- [ ] **Step 1: 写失败测试**

`tests/filter-form-c-footer.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FilterFormC, { countActivePicks, type FilterRow } from '@/components/frontend/listing/FilterFormC'

/** OPT-103：底栏不再报「N 套符合条件」，没有已选条件时整个底栏不渲染。 */

const ROWS: readonly FilterRow[] = [
  { key: 'district', label: '位置', options: [{ value: 'jingan', label: '静安', count: 3 }] },
]

function render(rows: readonly FilterRow[], extraPicks: readonly { key: string; label: string; href: string }[] = []) {
  return renderToStaticMarkup(createElement(FilterFormC, {
    rows,
    basePath: '/shanghai/listings',
    currentParams: new URLSearchParams(rows[0]?.activeValue ? `district=${rows[0].activeValue}` : ''),
    clearAllHref: '/shanghai/listings',
    extraPicks,
  }))
}

describe('FilterFormC 底栏', () => {
  it('没有已选条件：不渲染底栏、不出现「符合条件」', () => {
    const html = render(ROWS)
    expect(html).not.toContain('ls-filterc__footer')
    expect(html).not.toContain('符合条件')
  })

  it('有已选条件：只渲染 chip 与清除全部，仍然没有计数与分隔线', () => {
    const html = render([{ ...ROWS[0], activeValue: 'jingan' }])
    expect(html).toContain('ls-filterc__footer')
    expect(html).toContain('位置：静安')
    expect(html).toContain('清除全部')
    expect(html).not.toContain('符合条件')
    expect(html).not.toContain('ls-filterc__divider')
  })

  it('只有补充 chip（生效但无行可显示的条件）也算有条件', () => {
    const html = render(ROWS, [{ key: 'q', label: '关键词：整层', href: '/shanghai/listings' }])
    expect(html).toContain('关键词：整层')
    expect(html).toContain('清除全部')
  })

  it('countActivePicks 只按 rows 计数（开关型行已移除）', () => {
    expect(countActivePicks([{ ...ROWS[0], activeValue: 'jingan' }])).toBe(1)
    expect(countActivePicks(ROWS)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/filter-form-c-footer.test.ts`
Expected: FAIL（typecheck 层面缺 `totalCount`/`countNoun` 由 vitest 不拦，但 html 含「符合条件」→ 断言失败）。

- [ ] **Step 3: 改 `FilterFormC.tsx`**

1. 删除 `FilterSwitch` 类型声明整段（含其 JSDoc）。
2. `countActivePicks` 改为：
```ts
export function countActivePicks(rows: readonly FilterRow[]): number {
  return rows.filter((row) => row.options.length > 0 && rowShowsActivePick(row)).length
}
```
其 JSDoc 里「+ 开关」相关句子删掉。
3. Props：删 `totalCount`、`countNoun`（连同两段 JSDoc）、`switchRow`；解构改为 `const { rows, basePath, currentParams, clearAllHref, extraPicks } = props`。
4. `hasPicks` 改为 `picks.length > 0 || (extraPicks?.length ?? 0) > 0`。
5. 删除 `{switchRow ? (<div className="ls-filterc__row">…</div>) : null}` 整段。
6. 底栏改为**只在 hasPicks 时渲染**，并删计数、分隔线、开关 chip：
```tsx
      {hasPicks ? (
        <div className="ls-filterc__footer">
          {picks.map(({ row, option }) => (
            <NavLink key={row.key} href={buildClearRowHref(basePath, currentParams, row.key, row.clearsKeys)} className="ls-filterc__chip">
              {row.label}：{option.label}
              <span className="ls-filterc__chip-x" aria-hidden="true"><XMarkIcon size={10} /></span>
            </NavLink>
          ))}
          {(extraPicks ?? []).map((pick) => (
            <NavLink key={pick.key} href={pick.href} className="ls-filterc__chip">
              {pick.label}
              <span className="ls-filterc__chip-x" aria-hidden="true"><XMarkIcon size={10} /></span>
            </NavLink>
          ))}
          {/* href 由调用方给定：本组件收到的 rows 只是被渲染出来的那几行，不等于 URL 上真正生效的全部筛选维度。 */}
          <NavLink href={clearAllHref} className="ls-filterc__clear-all">清除全部</NavLink>
        </div>
      ) : null}
```
7. 文件头注释追加一段：「OPT-103：底栏不再报『N 套符合条件』（计数在页头副题与工具条已有，三处同屏是噪音），且只在有已选条件时渲染；开关型行（楼盘页『仅看有在租』）随开关一起移除。」

- [ ] **Step 4: 改 `MobileFilterSheet.tsx` / `MobileFilterShell.tsx`**

Sheet：import 改为 `import { countActivePicks, type FilterRow } from './FilterFormC'`；删 `switchRow?: FilterSwitch` prop 与 JSDoc；解构去掉 `switchRow`；`countActivePicks(rows)`；删 `{switchRow ? (<div className="ls-msheet__group">…</div>) : null}` 整段。第 118 行附近提到 `switchRow.paramKey` 的历史注释改成「曾经的实现是内部按 `rows.key` 逐个删」。

Shell：import 同上去掉 `FilterSwitch`；删 `switchRow?: FilterSwitch` prop；解构去掉；`countActivePicks(rows)`；删 `{...(switchRow ? { switchRow } : {})}`。注释里「开关本身仍然算一个条件，由该函数负责」一句删掉。

- [ ] **Step 5: 改 `list.css`**

删除：`.ls-filterc__count`、`.ls-filterc__divider` 两条规则；从「/* ── 开关型筛选项（FilterFormC.switchRow…」注释块起到 `@media (prefers-reduced-motion: reduce) { .ls-filterc__switch, .ls-filterc__switch-track { transition: none; } }` 止整段；抽屉里从「/* 抽屉里的开关行（楼盘页「仅看有在租」）…」注释起到 `@media (prefers-reduced-motion: reduce) { .ls-msheet__switch-track { transition: none; } }` 止整段。第 342 行注释里「开关 pill 36」与「这正是 `.ls-filterc__switch` 那段注释里记为…」两句改成「chip 28，整块低于 44 触达下限」（去掉对已删规则的引用）。

- [ ] **Step 6: 跑测试**

Run: `pnpm vitest run tests/filter-form-c-footer.test.ts tests/opt068-listing-navigation.test.ts`
Expected: PASS（opt068 那份读源码验 NavLink，删代码不影响）。此时 `pnpm typecheck` 会在两个 View 报 `totalCount`/`switchRow` 不存在——Task 4/5 修。

- [ ] **Step 7: 提交**

```bash
git add src/components/frontend/listing/FilterFormC.tsx src/components/frontend/listing/MobileFilterSheet.tsx src/components/frontend/listing/MobileFilterShell.tsx "src/app/(frontend)/styles/list.css" tests/filter-form-c-footer.test.ts
git commit -m "refactor(frontend): 筛选底栏去掉计数与开关型行，无已选条件时不渲染"
```

---

### Task 4: `CityBuildingsView` 接线 —— 删开关、老链接补 chip

**Files:**
- Modify: `src/components/frontend/city/CityBuildingsView.tsx`
- Modify: `tests/opt036-buildings-view-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2 的 rows（含 `businessArea`）、Task 3 的 `FilterFormC` 新签名。

- [ ] **Step 1: 改测试（先红）**

`tests/opt036-buildings-view-wiring.test.ts`：
1. import 行去掉 `type FilterSwitch`：`import { countActivePicks, type FilterRow } from '@/components/frontend/listing/FilterFormC'`。
2. `buildResult` 的 `facets` 类型与默认值加 `businessAreas: []`（类型：`businessAreas: { slug: string; name: string; count: number }[]`），`dimensionHits` 加 `businessArea: 7`。
3. `shellRows` 改为 `Readonly<{ rows: readonly FilterRow[] }>`。
4. 删除用例「计数名词是楼盘语境，不是房源的「套」」里对 `FilterFormC` 的那一行断言，只保留 `MobileFilterShell` 的 `countNoun` 断言。
5. 用例「「仅看有在租」开关：只切 onlyWithStock…」**整个替换**为：
```ts
  it('OPT-103：没有开关行；?onlyWithStock=1 老链接仍补一个可清除 chip', () => {
    const form = findByDisplayName(renderView('?district=jingan&onlyWithStock=1', buildResult()), 'FilterFormC')!
    const props = form.node.props as { switchRow?: unknown; extraPicks?: readonly { key: string; label: string; href: string }[] }
    expect(props.switchRow).toBeUndefined()
    const pick = props.extraPicks?.find((p) => p.key === 'onlyWithStock')
    expect(pick?.label).toBe('在租状态：仅看有在租')
    expect(pick?.href).toBe('/shanghai/buildings?district=jingan')
    const shell = findByDisplayName(renderView('', buildResult()), 'MobileFilterShell')!
    expect((shell.node.props as { switchRow?: unknown }).switchRow).toBeUndefined()
  })

  it('OPT-103：商圈行在位置行之后；选区后才有候选', () => {
    const result = buildResult({ facets: {
      districts: [{ slug: 'jingan', name: '静安区', count: 2 }],
      businessAreas: [{ slug: 'jingan-temple', name: '静安寺', count: 1 }],
      grades: [], metros: [],
    } })
    const keys = (q: string) => shellRows(findByDisplayName(renderView(q, result), 'MobileFilterShell')!).rows.map((r) => r.key)
    expect(keys('')).toEqual(['district', 'businessArea', 'grade', 'metro', 'leasableAreaMin', 'completedAfter'])
    const areaRow = (q: string) => shellRows(findByDisplayName(renderView(q, result), 'MobileFilterShell')!).rows.find((r) => r.key === 'businessArea')!
    expect(areaRow('').options).toEqual([])
    expect(areaRow('?district=jingan').options.map((o) => o.value)).toEqual(['jingan-temple'])
  })
```
6. 用例「开关与能显示的行照常计数」改为：
```ts
  it('老链接的 onlyWithStock 不进徽标（它由补充 chip 显示，不在抽屉里）', () => {
    const onlySwitch = findByDisplayName(renderView('?onlyWithStock=1&leasableAreaMin=750', buildResult({ withStock: [doc('a', 2)] })), 'MobileFilterShell')!
    expect(shellBadge(onlySwitch)).toBe(0)
    const rowAndSwitch = findByDisplayName(renderView('?onlyWithStock=1&district=jingan', buildResult({ withStock: [doc('a', 2)] })), 'MobileFilterShell')!
    expect(shellBadge(rowAndSwitch)).toBe(1)
  })
```
7. 用例「徽标数恒等于抽屉头部所用的同一个口径函数」：`const { rows } = shellRows(shell)`，`countActivePicks(rows)`。
8. 文件头注释第 7 条改为「7. 『仅看有在租』开关已于 OPT-103 移除；`?onlyWithStock=1` 老链接由补充 chip 显示并可清除」。

Run: `pnpm vitest run tests/opt036-buildings-view-wiring.test.ts`
Expected: FAIL（`switchRow` 仍传入、`extraPicks` 无 onlyWithStock）。

- [ ] **Step 2: 改 `CityBuildingsView.tsx`**

1. import：`import FilterFormC, { rowShowsActivePick } from '@/components/frontend/listing/FilterFormC'`（去掉 `type FilterSwitch`）。
2. 删除从 `// 「仅看有在租」开关：开→关 与 关→开 是同一个 href` 到 `subLabel: ...` 的整段（`switchHref` 与 `switchRow` 常量）。
3. 删除 `if (scope === 'lease' && switchRow.active) rowActiveKeys.add(switchRow.paramKey)`。
4. `<FilterFormC>` 调用去掉 `totalCount`、`countNoun`、`switchRow` 三个 prop。
5. `<MobileFilterShell>` 调用去掉 `switchRow` prop（`totalDocs` / `countNoun` 保留）。
6. `result` 解构里 `withStockTotal` 仍被页头副题与分组标题用，保留；`dimensionHits` 仍被 relaxations 用，保留。
7. 文件头注释：「筛选条 C（6 行，末行是『仅看有在租』开关 pill）」改为「筛选条 C（6 行文本条件：位置 / 商圈 / 等级 / 地铁 / 在租面积 / 竣工年代；OPT-103 移除了『仅看有在租』开关，`?onlyWithStock=1` 老链接经 extraPicks 补 chip）」；`SCOPE_COPY` 注释里「『仅看有在租』开关在出售口径下没有意义（恒为真），不渲染」删掉。

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run tests/opt036-buildings-view-wiring.test.ts tests/opt036-facet-query-dedupe.test.ts && pnpm typecheck 2>&1 | grep -v CityListingsView`
Expected: 两个测试文件 PASS；typecheck 只剩 `CityListingsView.tsx` 的报错（Task 5）。

- [ ] **Step 4: 提交**

```bash
git add src/components/frontend/city/CityBuildingsView.tsx tests/opt036-buildings-view-wiring.test.ts
git commit -m "feat(frontend): 楼盘列表去掉在租状态开关，接入商圈行"
```

---

### Task 5: `CityListingsView` —— 去单位行、`businessType` → `channel`、coworking 语义

**Files:**
- Create: `src/lib/frontend/coworking-channel.ts`
- Modify: `src/components/frontend/city/CityListingsView.tsx`
- Modify: `src/app/(frontend)/[city]/sale/page.tsx:73`、`src/app/(frontend)/sale/page.tsx:87`（`businessType="sale"` → `channel="sale"`）
- Modify: `tests/opt036-listings-view-wiring.test.ts`
- Test: `tests/coworking-channel.test.ts`（新）

**Interfaces:**
- Produces: `CityListingsView` prop `channel?: 'lease' | 'sale' | 'coworking'`（默认 `'lease'`，**`businessType` prop 删除**）；`coworking-channel.ts` 导出 `COWORKING_LISTING_TYPE = 'coworking'`、`coworkingChannelPath(citySlug?: string): string`、`lockCoworkingInput(input: ListingSearchInput): ListingSearchInput`、`buildCoworkingCanonicalParams(input: ListingSearchInput): URLSearchParams`。

- [ ] **Step 1: 写 `coworking-channel.ts` 的失败测试**

`tests/coworking-channel.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseListingSearchInput } from '@/domain/public-catalog'
import {
  buildCoworkingCanonicalParams,
  COWORKING_LISTING_TYPE,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'

/** OPT-103：共享办公独立频道的三个纯函数。 */
describe('coworking-channel', () => {
  it('路径：带城市前缀与 legacy 两种', () => {
    expect(coworkingChannelPath('shanghai')).toBe('/shanghai/coworking')
    expect(coworkingChannelPath()).toBe('/coworking')
  })

  it('lockCoworkingInput 强制类型为共享办公，覆盖 URL 里的任何 type', () => {
    const locked = lockCoworkingInput(parseListingSearchInput(new URLSearchParams('?type=full-floor&district=jingan')))
    expect(locked.listingType).toEqual([COWORKING_LISTING_TYPE])
    expect(locked.district).toEqual(['jingan'])
  })

  it('canonical 不输出 type，其余参数照旧', () => {
    const locked = lockCoworkingInput(parseListingSearchInput(new URLSearchParams('?district=jingan&areaMin=100&page=2')))
    expect(buildCoworkingCanonicalParams(locked).toString()).toBe('district=jingan&areaMin=100&page=2')
  })
})
```

Run: `pnpm vitest run tests/coworking-channel.test.ts` → FAIL（模块不存在）。

- [ ] **Step 2: 写 `src/lib/frontend/coworking-channel.ts`**

```ts
import { buildCanonicalSearchParams, type ListingSearchInput } from '@/domain/public-catalog'

/**
 * 共享办公独立频道（OPT-103）。
 *
 * 与 `sale-channel.ts` 同形：`/[city]/coworking` 是 `CityListingsView` 的另一个实例，
 * 差别只在**类型被锁死**——路由层把 `listingType` 强制为 `['coworking']`、canonical
 * 不输出 `type`。类型不是这个页面的一个条件，是它的定义；因此它不出现在筛选行、
 * 不出现在 chip、不进「清除全部」的作用域（见 CityListingsView 的 `lockedDimensions`）。
 *
 * 查询缓存无需关心这里：`getCachedSearchListings` 的缓存键是城市 + 频道扫描，
 * 分页 / 筛选在内存里按 `input` 做，锁定的类型自然进 `input`。
 */

export const COWORKING_LISTING_TYPE = 'coworking'

export function coworkingChannelPath(citySlug?: string): string {
  return citySlug ? `/${citySlug}/coworking` : '/coworking'
}

/** 覆盖 URL 里任何 `type=`：`/coworking?type=full-floor` 仍然只看共享办公。 */
export function lockCoworkingInput(input: ListingSearchInput): ListingSearchInput {
  return { ...input, listingType: [COWORKING_LISTING_TYPE] }
}

/** 频道 canonical：与房源列表同一份序列化，只是不输出被锁定的 `type`。 */
export function buildCoworkingCanonicalParams(input: ListingSearchInput): URLSearchParams {
  const sp = buildCanonicalSearchParams(input)
  sp.delete('type')
  return sp
}
```

Run: `pnpm vitest run tests/coworking-channel.test.ts` → PASS。

- [ ] **Step 3: 改 listings wiring 测试（先红）**

`tests/opt036-listings-view-wiring.test.ts`：
1. 删 `import ExcludedUnitsBar ...` 与 import 里的 `type FilterSwitch`。
2. `renderView` 的 overrides 类型与调用：`businessType` → `channel: 'lease' | 'sale' | 'coworking'`，`...(overrides.channel ? { channel: overrides.channel } : {})`。
3. `shellRows` 改为 `Readonly<{ rows: readonly FilterRow[] }>`；「徽标数恒等于…」用例改 `const { rows } = shellRows(shell)`，`countActivePicks(rows)`。
4. 用例「facet 全部走剥离版本」：期望的维度集合里**删掉 `['priceUnit']`**（保留 district+businessArea / businessArea / listingType / buildingForm）；用例「绝不退回未剥离的 getCachedSearchFacets」改为 `expect(dimensionSets).toContainEqual(['district', 'businessArea'])`。
5. 「剥离查询把频道透传下去」：`renderView('', { channel: 'sale' })`。
6. 「无 priceUnit 时价格排序两项不进 sorts；有 priceUnit 时进」保留原样（老链接行为）。
7. 「计价单位不补 chip」保留。
8. 「被排除单位提示条的量词…」**替换**为：
```ts
  it('OPT-103：单位分段与被排除单位提示条不再渲染（带 priceUnit 的老链接也一样）', async () => {
    getCachedSearchFacetsIgnoring.mockResolvedValue({ districts: [], listingTypes: [], buildingForms: [], rentUnits: [{ value: 'rmb-sqm-day', count: 3 }, { value: 'rmb-month', count: 536 }], totalDocs: 3 })
    const tree = await renderView('?priceUnit=rmb-sqm-day', { totalDocs: 3 })
    expect(findByDisplayName(tree, 'PriceUnitSegment')).toBeUndefined()
    expect(findByDisplayName(tree, 'ExcludedUnitsBar')).toBeUndefined()
    expect(findByDisplayName(tree, 'FilterFormC')).toBeDefined()
  })
```
9. 新增一组 coworking 用例（放在 describe 末尾）：
```ts
  describe('OPT-103 共享办公频道', () => {
    const coworking = (query: string, totalDocs = 3) =>
      renderView(query, { channel: 'coworking', totalDocs, districts: [{ slug: 'jingan', name: '静安' }] })

    it('类型行不渲染，页内 href 不带 type', async () => {
      const tree = await coworking('?district=jingan')
      const form = findByDisplayName(tree, 'FilterFormC')!.node.props as { rows: readonly FilterRow[]; currentParams: URLSearchParams; clearAllHref: string }
      expect(form.rows.map((r) => r.key)).not.toContain('type')
      expect(form.currentParams.has('type')).toBe(false)
      expect(form.clearAllHref).toBe('/shanghai/listings')
    })

    it('类型不补 chip、不进退路、不进已选计数', async () => {
      const tree = await coworking('?district=jingan', 0)
      const form = findByDisplayName(tree, 'FilterFormC')!.node.props as { extraPicks?: readonly { key: string }[] }
      expect(form.extraPicks?.map((p) => p.key) ?? []).not.toContain('listingType')
      const empty = findByDisplayName(tree, 'EmptyFiltered')!.node.props as { relaxations: readonly { label: string }[] }
      expect(empty.relaxations.map((r) => r.label)).toEqual(['取消「位置：静安」这一个条件'])
      const shell = findByDisplayName(tree, 'MobileFilterShell')!
      expect(shellBadge(shell)).toBe(1)
    })

    it('剥离查询不剥类型：空态①与「清除全部」的总数仍是共享办公口径', async () => {
      await coworking('', 0)
      for (const call of getCachedSearchFacetsIgnoring.mock.calls) {
        expect(call[2]).not.toContain('listingType')
        expect(call[3]).toBe('lease')
      }
    })

    it('页头文案：标题「上海共享办公」、副题主语「共享办公房源」', async () => {
      const html = renderToStaticMarkup(await coworking(''))
      expect(html).toContain('上海共享办公</h1>')
      expect(html).toContain('套共享办公房源')
    })
  })
```
（`renderToStaticMarkup` 在文件顶部已 import。）

Run: `pnpm vitest run tests/opt036-listings-view-wiring.test.ts` → FAIL（`channel` 未识别、`PriceUnitSegment` 仍在）。

- [ ] **Step 4: 改 `CityListingsView.tsx`**

1. 删 import：`ExcludedUnitsBar, { type ExcludedUnitOption }`、`PriceUnitSegment, { type PriceUnitOption }`。
2. `CHANNEL_COPY` 改为三个频道，每项加 `heading`，删 `unitNote / unitRowLabel`：
```ts
const CHANNEL_COPY = {
  lease: {
    heading: '在租房源',
    noun: '在租房源',
    countNoun: '套',
    totalNoun: '套在租房源',
    unitDimensionLabel: '租金单位',
    priceRowLabel: '租金上限',
    priceDimensionLabel: '租金',
  },
  sale: {
    heading: '出售房源',
    noun: '出售房源',
    countNoun: '套',
    totalNoun: '套出售房源',
    unitDimensionLabel: '计价单位',
    priceRowLabel: '总价上限',
    priceDimensionLabel: '总价',
  },
  /** OPT-103：共享办公频道。类型被路由层锁死，见 lib/frontend/coworking-channel.ts。 */
  coworking: {
    heading: '共享办公',
    noun: '共享办公房源',
    countNoun: '套',
    totalNoun: '套共享办公房源',
    unitDimensionLabel: '租金单位',
    priceRowLabel: '租金上限',
    priceDimensionLabel: '租金',
  },
} as const satisfies Record<'lease' | 'sale' | 'coworking', Readonly<Record<string, string>>>
```
`CHANNEL_COPY` 的 JSDoc 补一句「`heading` 是页头标题的频道词（『上海』+ heading），`noun` 是计数主语」。
3. 删 `PRICE_UNIT_ORDER` 常量整段（含 JSDoc）。
4. Props：`businessType?: 'lease' | 'sale'` → `channel?: 'lease' | 'sale' | 'coworking'`，JSDoc 改为「当前频道；决定文案、类型锁定与查询口径（`sale` 查出售扫描，其余查租赁）。缺省租赁，既有调用零改动。」；解构 `channel = 'lease'`。
5. 函数体开头：
```ts
  const copy = CHANNEL_COPY[channel]
  const businessType: 'lease' | 'sale' = channel === 'sale' ? 'sale' : 'lease'
  const heading = routeMode === 'legacy' ? copy.heading : `${city.name}${copy.heading}`
  // 被频道锁定的维度：不是条件、不可清除、不进退路与计数（coworking 的类型）。
  const lockedDimensions: readonly ListingSearchDimension[] = channel === 'coworking' ? ['listingType'] : []
  const clearableDimensions = LISTING_CLEARABLE_DIMENSIONS.filter((d) => !lockedDimensions.includes(d))
```
6. `activeDimensions = allDimensions.filter((d) => d.active && !lockedDimensions.includes(d.dimension))`。
7. `currentParams`：在 `buildCanonicalSearchParams(input)` 之后加 `for (const d of lockedDimensions) for (const key of allDimensions.find((x) => x.dimension === d)?.paramKeys ?? []) currentParams.delete(key)`（coworking 时删 `type`）。
8. 取数 `Promise.all`：删第一项 `facetsOmitting(['priceUnit'])`（及解构里的 `unitFacets`）；`typeFacets` 改为 `lockedDimensions.includes('listingType') ? Promise.resolve(null) : facetsOmitting(['listingType'])`；`clearAllFacets` 与 `noStockFacets` 里的 `LISTING_CLEARABLE_DIMENSIONS` 换成 `clearableDimensions`。注释里「剥 priceUnit：算『另有多少套按别的单位报价』…」那一条删掉。
9. 删 `unitCounts` / `units` / `excludedUnits` / `pricedInActiveUnit` / `unpricedCount` 四段。
10. `buildListingFilterRows` 调用：`typeCounts: toCountMap(typeFacets?.listingTypes ?? [])`；其后加 `const visibleRows = lockedDimensions.includes('listingType') ? rows.filter((row) => row.key !== 'type') : rows`，后续 `FilterFormC` / `MobileFilterShell` / `rowActiveKeys` 全部用 `visibleRows`。
11. `clearAllHref` 与 `extraPicks` 里的 `LISTING_CLEARABLE_DIMENSIONS.includes` 换成 `clearableDimensions.includes`。
12. 页头副题改为：
```tsx
        <p className="ls-head__sub">
          共 <span className="sf-num">{totalDocs}</span> {copy.countNoun}
          {activeUnit ? (
            <>按 <span className="ls-head__sub-strong">{priceUnitLabel(activeUnit)}</span> 报价的{copy.noun}</>
          ) : (
            copy.noun
          )}
        </p>
```
（`priceUnitLabel` import 保留；旧「其中 N 套价格面议、未计入上方单位计数」句子指向已删控件，一并去掉。）
13. 删 `<div className="ls-container ls-unitband"><PriceUnitSegment …/></div>` 整块；`<FilterFormC>` 去掉 `totalCount` / `countNoun`；删 `{excludedUnits.length > 0 ? <ExcludedUnitsBar …/> : null}` 整块。
14. `<ResultToolbar>` 的 `sorts` 逻辑不动（老链接带 priceUnit 仍有价格排序）。
15. 文件头注释「组合顺序照 comp：页头 → 单位分段 → 筛选条 C → 结果工具条 → 结果网格 → 被排除单位提示条 → 分页」改为「页头 → 筛选条 C → 结果工具条 → 结果网格 → 分页（OPT-103 去掉了单位分段与被排除单位提示条：单位不再是用户可选的控件，带 `?priceUnit=` 的老链接仍按单位解析、仍出租金上限行与价格排序）」。

- [ ] **Step 5: 两个 sale 路由改 prop 名**

`src/app/(frontend)/[city]/sale/page.tsx` 与 `src/app/(frontend)/sale/page.tsx`：`businessType="sale"` → `channel="sale"`。

- [ ] **Step 6: 跑测试与 typecheck**

Run: `pnpm vitest run tests/opt036-listings-view-wiring.test.ts tests/opt036-facet-query-dedupe.test.ts tests/coworking-channel.test.ts tests/listing-price-unit-gate.test.ts && pnpm typecheck`
Expected: 全 PASS，typecheck 干净。

- [ ] **Step 7: 提交**

```bash
git add src/lib/frontend/coworking-channel.ts src/components/frontend/city/CityListingsView.tsx "src/app/(frontend)/[city]/sale/page.tsx" "src/app/(frontend)/sale/page.tsx" tests/opt036-listings-view-wiring.test.ts tests/coworking-channel.test.ts
git commit -m "feat(frontend): 房源列表去掉租金单位行；CityListingsView 频道泛化并支持共享办公锁定"
```

---

### Task 6: 共享办公路由 + city-routes + metadata

**Files:**
- Create: `src/app/(frontend)/[city]/coworking/page.tsx`
- Create: `src/app/(frontend)/coworking/page.tsx`
- Modify: `src/lib/frontend/city-routes.ts`（`CityPageType`、`RESERVED_CITY_ROOT_SEGMENTS`、`parseSegments` 两处、`buildCityPath`、`switchCityUrl`、`legacyCanonicalPath`、`prefixedCanonicalPath`、`cityAwareHref`）
- Modify: `src/lib/frontend/metadata.ts:48, 118-137`
- Modify: `tests/city-routes.test.ts`、`tests/city-route-pages.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `channel="coworking"`、`coworking-channel.ts` 三个函数。
- Produces: `CityPageType` 含 `'coworking'`；`CityMetadataPageType` 含 `'coworking'`。

- [ ] **Step 1: 改 city-routes 测试（先红）**

`tests/city-routes.test.ts` 在出现 `cityAwareHref('/sale', …)` 的那个用例附近新增：
```ts
  it('OPT-103：共享办公频道是城市页，与 listings 同一套查询白名单', () => {
    expect(getCityPageType('/coworking')).toBe('coworking')
    expect(getCityPageType('/shanghai/coworking')).toBe('coworking')
    expect(buildCityPath('shanghai', 'coworking')).toBe('/shanghai/coworking')
    expect(cityAwareHref('/coworking', 'shanghai', true)).toBe('/shanghai/coworking')
    expect(cityAwareHref('/coworking', 'shanghai', false)).toBe('/coworking')
    expect(switchCityUrl('/shanghai/coworking?district=jingan&areaMin=100&extra=drop', 'hangzhou')).toBe('/hangzhou/coworking?areaMin=100')
    expect(prefixedCanonicalPath('/coworking?district=changning&page=2', 'shanghai')).toBe('/shanghai/coworking?district=changning&page=2')
    expect(legacyCanonicalPath('/shanghai/coworking?district=changning')).toBe('/coworking?district=changning')
  })
```
（`getCityPageType` / `buildCityPath` / `switchCityUrl` / `prefixedCanonicalPath` / `legacyCanonicalPath` / `cityAwareHref` 若该文件尚未全部 import，补齐 import。`switchCityUrl` 对 `district` 的处理照该文件既有 listings 用例的口径——若既有用例显示换城时 `district` 被丢弃，则期望里不含 `district`；本例按「换城丢 district、留 areaMin」写。）

`tests/city-route-pages.test.ts`：
1. import 加 `import CityCoworkingPage, { generateMetadata as generateCoworkingMetadata } from '@/app/(frontend)/[city]/coworking/page'` 与 `import LegacyCoworkingPage from '@/app/(frontend)/coworking/page'`。
2. `vi.mock('@/domain/public-catalog', …)` 的返回里 `buildCanonicalSearchParams` 改为**真实现**：`buildCanonicalSearchParams: (input: { listingType?: readonly string[]; district?: readonly string[] }) => { const sp = new URLSearchParams(); for (const v of input.district ?? []) sp.append('district', v); for (const v of input.listingType ?? []) sp.append('type', v); return sp }`（够本文件用例用；原先返回空串的用例不受影响，因为它们的 mock input 无 district/type）。
3. 在出售频道两个用例之后加：
```ts
  it('共享办公频道：类型锁定为 coworking、canonical 指向 /[city]/coworking 且不含 type', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    io.parseListingSearchInput.mockReturnValue({ page: 1, listingType: ['full-floor'], district: ['jingan'] })
    io.getCachedListingDistrictOptions.mockResolvedValue([{ id: 1, slug: 'jingan', name: '静安' }])
    io.getCachedSearchListings.mockResolvedValue({ docs: [], pagination: { page: 1, totalPages: 1, totalDocs: 3 } })

    await expect(generateCoworkingMetadata({
      params: Promise.resolve({ city: 'shanghai' }),
      searchParams: Promise.resolve({ type: 'full-floor', district: 'jingan' }),
    })).resolves.toMatchObject({
      title: '上海共享办公 · 工位与联合办公',
      alternates: { canonical: '/shanghai/coworking?district=jingan' },
      robots: { index: true, follow: true },
    })

    const page = await CityCoworkingPage({
      params: Promise.resolve({ city: 'shanghai' }),
      searchParams: Promise.resolve({ type: 'full-floor', district: 'jingan' }),
    })
    const props = page.props as { channel: string; basePath: string; input: { listingType?: readonly string[] } }
    expect(props.channel).toBe('coworking')
    expect(props.basePath).toBe('/shanghai/coworking')
    expect(props.input.listingType).toEqual(['coworking'])
    expect(io.getCachedSearchListings).toHaveBeenCalledWith('shanghai', 'district=jingan', expect.objectContaining({ listingType: ['coworking'] }), 'lease')
  })

  it('共享办公频道：开关开启时 legacy /coworking 307 到带前缀的 URL，query 原样透传', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    await expect(LegacyCoworkingPage({ searchParams: Promise.resolve({ district: 'jingan', page: '2' }) }))
      .rejects.toThrow('redirect:/shanghai/coworking?district=jingan&page=2')
  })

  it('共享办公频道：开关关闭时 legacy 渲染，canonical 归还给无前缀 /coworking', async () => {
    io.parseListingSearchInput.mockReturnValue({ page: 1 })
    io.getCachedSearchListings.mockResolvedValue({ docs: [], pagination: { page: 1, totalPages: 1, totalDocs: 3 } })
    const page = await LegacyCoworkingPage({ searchParams: Promise.resolve({}) })
    const props = page.props as { channel: string; basePath: string; routeMode: string }
    expect(props).toMatchObject({ channel: 'coworking', basePath: '/coworking', routeMode: 'legacy' })
    await expect(generateCoworkingMetadata({
      params: Promise.resolve({ city: 'shanghai' }),
      searchParams: Promise.resolve({}),
    })).resolves.toMatchObject({ alternates: { canonical: '/coworking' }, robots: { index: false, follow: true } })
  })
```

Run: `pnpm vitest run tests/city-routes.test.ts tests/city-route-pages.test.ts` → FAIL（模块不存在 / pageType 未知）。

- [ ] **Step 2: 改 `city-routes.ts`**

1. `CityPageType` 在 `| 'sale'` 之后加 `// 共享办公频道（OPT-103）：与 listings 同构，类型由路由锁死。\n  | 'coworking'`。
2. `RESERVED_CITY_ROOT_SEGMENTS` 加 `'coworking'`。
3. 解析：`if (segments.length === 1 && segments[0] === 'sale') return route('sale', null)` 之后加 `if (segments.length === 1 && segments[0] === 'coworking') return route('coworking', null)`；`if (resource === 'sale' && !slug) return route('sale', citySlug)` 之后加 `if (resource === 'coworking' && !slug) return route('coworking', citySlug)`。
4. `buildCityPath`：`case 'sale': return \`/${citySlug}/sale\`` 之后加 `case 'coworking': return \`/${citySlug}/coworking\``。
5. `switchCityUrl`：`case 'sale'` 分支之后加
```ts
    case 'coworking':
      return withQuery(`/${destinationCitySlug}/coworking`, selectListingQuery(route.params))
```
6. `legacyCanonicalPath`：加 `case 'coworking': return withQuery('/coworking', passThroughQuery(route.params))`。
7. `prefixedCanonicalPath`：加 `case 'coworking': return withQuery(\`/${citySlug}/coworking\`, passThroughQuery(route.params))`。
8. `cityAwareHref`：条件改为 `if (pageType === 'listings' || pageType === 'sale' || pageType === 'coworking' || pageType === 'buildings')`。
9. 其它对 `CityPageType` 穷举的 `switch`（如有 exhaustive check）按 typecheck 报错逐个补 `'coworking'` 分支，行为同 `'listings'`。

- [ ] **Step 3: 改 `metadata.ts`**

`CityMetadataPageType = 'home' | 'listings' | 'buildings' | 'sale' | 'coworking'`；`CITY_PAGE_COPY` 加：
```ts
  // 共享办公频道（OPT-103）：canonical 指向频道自身，理由同 sale。
  coworking: {
    title: (cityName) => `${cityName}共享办公 · 工位与联合办公`,
    description: (cityName) => `${cityName}共享办公、联合办公与灵活工位在租房源。`,
  },
```

- [ ] **Step 4: 写两个路由文件**

`src/app/(frontend)/[city]/coworking/page.tsx`：

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/search-input'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import {
  buildCoworkingCanonicalParams,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

/**
 * 共享办公频道（OPT-103）。与 `[city]/sale/page.tsx` 同形：`CityListingsView` 的另一个实例，
 * 差别是类型由这里锁死为 coworking、canonical 不输出 `type`（见 lib/frontend/coworking-channel.ts）。
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ params: Promise<{ city: string }>; searchParams: Promise<SearchParams> }>

function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const query = buildCoworkingCanonicalParams(input).toString()
  return buildCityPageMetadata({
    city,
    pageType: 'coworking',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityCoworkingPage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const canonical = buildCoworkingCanonicalParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={coworkingChannelPath(city.slug)}
      routeMode="prefixed"
      channel="coworking"
      view={parseListingViewMode(raw.view)}
    />
  )
}
```

`src/app/(frontend)/coworking/page.tsx`：

```tsx
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/search-input'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import {
  buildCoworkingCanonicalParams,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'

/** legacy `/coworking`（OPT-103）：与 `sale/page.tsx` 同形——多城市开关开启时 307 到带前缀 URL，否则按默认城市渲染。 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ searchParams: Promise<SearchParams> }>

function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}

function sourceUrl(pathname: string, value: SearchParams): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.append(key, raw)
    else for (const item of raw ?? []) params.append(key, item)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const input = lockCoworkingInput(
    await resolveListingSearchInput(siteConfig.defaultCity, toUrlSearchParams(await searchParams)),
  )
  const query = buildCoworkingCanonicalParams(input).toString()
  return buildPageMetadata({
    title: '共享办公',
    canonicalPath: query ? `/coworking?${query}` : '/coworking',
  })
}

export default async function CoworkingPage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl(coworkingChannelPath(), raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const canonical = buildCoworkingCanonicalParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={coworkingChannelPath()}
      routeMode="legacy"
      channel="coworking"
      view={parseListingViewMode(raw.view)}
    />
  )
}
```

（对照 `listings/page.tsx` 的 legacy metadata：那边 title 是「在租房源」纯字面量；这里同样纯字面量「共享办公」。若 `buildPageMetadata` 要求 `robots` 字段，照 `sale/page.tsx` 的 `{ ...base, robots: { index: false, follow: true } }` 在非 live 时补。）

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run tests/city-routes.test.ts tests/city-route-pages.test.ts tests/site-nav-current.test.ts && pnpm typecheck`
Expected: PASS；typecheck 干净（若 `city-routes.ts` 有 exhaustive switch 未覆盖会在这里报，补分支）。

- [ ] **Step 6: 提交**

```bash
git add "src/app/(frontend)/[city]/coworking/page.tsx" "src/app/(frontend)/coworking/page.tsx" src/lib/frontend/city-routes.ts src/lib/frontend/metadata.ts tests/city-routes.test.ts tests/city-route-pages.test.ts
git commit -m "feat(frontend): 共享办公独立频道路由 /[city]/coworking（类型锁定、canonical 不含 type）"
```

---

### Task 7: 导航目标、首页类型卡、sitemap

**Files:**
- Modify: `src/lib/frontend/nav-targets.ts:36-40`
- Modify: `src/lib/frontend/public-nav.ts:35, 55`、`src/lib/frontend/site-settings-view.ts:118, 137`
- Modify: `src/components/frontend/home/HomeTypeCards.tsx:28`
- Modify: `src/app/(frontend)/sitemap.ts:136-141`
- Modify: `tests/sitemap-static-routes.test.ts:86-100`
- Test: `tests/coworking-nav-targets.test.ts`（新）

**Interfaces:**
- Produces: `navTargetById('listings-type-coworking').href === '/coworking'`；`SLOT_TARGETS.coworking.href === '/coworking'`；sitemap 每个已开城城市含 `{prefix}/coworking`。

- [ ] **Step 1: 写失败测试**

`tests/coworking-nav-targets.test.ts`：
```ts
import { describe, expect, it } from 'vitest'
import { navTargetById } from '@/lib/frontend/nav-targets'
import { MAIN_NAV_ITEMS, FOOTER_COLUMNS } from '@/lib/frontend/public-nav'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings'
import { SLOT_TARGETS } from '@/components/frontend/home/HomeTypeCards'

/**
 * OPT-103：共享办公入口全部指向独立频道 /coworking。
 * 生产后台 SiteSettings.mainNav 存的是目标 id（listings-type-coworking），只改 href 即零迁移。
 */
describe('共享办公入口', () => {
  it('导航目标池：listings-type-coworking 的 href 是 /coworking，其余类型目标不动', () => {
    expect(navTargetById('listings-type-coworking')?.href).toBe('/coworking')
    expect(navTargetById('listings-type-full-floor')?.href).toBe('/listings?type=full-floor')
  })

  it('默认主导航与站点设置兜底里再没有 /listings?type=coworking', () => {
    const hrefs = [
      ...MAIN_NAV_ITEMS.map((i) => i.href),
      ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
      ...SITE_SETTINGS_FALLBACK.mainNav.map((i) => i.href),
      ...SITE_SETTINGS_FALLBACK.footerColumns.flatMap((c) => c.links.map((l) => l.href)),
    ]
    expect(hrefs).not.toContain('/listings?type=coworking')
    expect(hrefs.filter((h) => h === '/coworking').length).toBeGreaterThanOrEqual(2)
  })

  it('首页类型卡 coworking 槽位跳独立频道', () => {
    expect(SLOT_TARGETS['coworking']?.href).toBe('/coworking')
  })
})
```

Run: `pnpm vitest run tests/coworking-nav-targets.test.ts` → FAIL。

- [ ] **Step 2: 改四处 href**

`nav-targets.ts`：
```ts
const TYPE_TARGETS: readonly NavTarget[] = LISTING_TYPES.map((type) => ({
  id: `listings-type-${type}`,
  // OPT-103：共享办公升格为独立频道，目标 id 不变（枚举值进了迁移），只改落点。
  href: type === 'coworking' ? '/coworking' : `/listings?type=${type}`,
  defaultLabel: LISTING_TYPE_LABELS[type],
}))
```
`public-nav.ts` 第 35 行与第 55 行、`site-settings-view.ts` 第 118 行与第 137 行：`'/listings?type=coworking'` → `'/coworking'`（label 不动）。
`HomeTypeCards.tsx` 第 28 行：`'coworking': { href: '/coworking', type: 'coworking', event: 'home_cat_coworking' },`。

- [ ] **Step 3: sitemap**

`sitemap.ts` 第 139 行 `{ url: \`${prefix}/listings\` … }` 之后加：
```ts
      // 共享办公频道（OPT-103）：与 /listings 同口径无条件收录——sitemap 条目不带房源类型，
      // 不为此扩 adapter 的 select；出售频道那种按数量设门槛的做法不沿用。
      { url: `${prefix}/coworking`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
```
`tests/sitemap-static-routes.test.ts` 用例「enumerates only live city roots…」加 `expect(urls).toContain('https://example.com/shanghai/coworking')` 与 `expect(urls).not.toContain('https://example.com/hangzhou/coworking')`；用例「emits only default-city legacy…」加 `expect(urls).toContain('https://example.com/coworking')`。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run tests/coworking-nav-targets.test.ts tests/nav-target-pool-coverage.test.ts tests/opt096-nav-submenu.test.ts tests/sitemap-static-routes.test.ts tests/sale-channel-always-on.test.ts tests/type-card-slots-consistency.test.ts`
Expected: 全 PASS（`nav-target-pool-coverage` 的「路由 → 池」用例靠新 href 覆盖新顶层路由 `coworking`）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/frontend/nav-targets.ts src/lib/frontend/public-nav.ts src/lib/frontend/site-settings-view.ts src/components/frontend/home/HomeTypeCards.tsx "src/app/(frontend)/sitemap.ts" tests/coworking-nav-targets.test.ts tests/sitemap-static-routes.test.ts
git commit -m "feat(frontend): 共享办公入口改指 /coworking，sitemap 收录频道页"
```

---

### Task 8: E2E 与全量闸门

**Files:**
- Create: `tests/e2e/coworking-channel.spec.ts`
- Modify（按需）: `tests/e2e/*.spec.ts` 中断言「符合条件」「仅看有在租」「租金单位」「计价单位」的用例

- [ ] **Step 1: 搜 E2E 里的过期断言**

Run: `grep -rn "符合条件\|仅看有在租\|租金单位\|计价单位\|ls-filterc__count\|ls-filterc__switch\|ls-unitband" tests/e2e/`
Expected: 只有 `f7-2-visual-review.spec.ts:159` 的「没有符合条件的房源」（那是 dev-story 空态标题，**不是**底栏计数，保留）。若还有别的命中，逐条改成不依赖已删控件的断言。

- [ ] **Step 2: 写 `tests/e2e/coworking-channel.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

import { expectCanonical } from './_canonical'

/**
 * 共享办公频道冒烟（OPT-103）。与 sale-channel.spec.ts 同一取舍：只验路由活着、
 * 类型行确实没有、页内链接不带 type、没有客户端报错；不断言具体房源。
 */

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'

test.describe('共享办公频道', () => {
  test('/coworking 可达且不是 404，canonical 指向频道自身', async ({ page }) => {
    const response = await page.goto('/coworking')
    expect(response?.status(), '/coworking 返回非 200：频道路由挂了').toBe(200)
    await expect(page.locator('body')).not.toContainText('这个地址不存在')
    await expectCanonical(page, routingEnabled ? '/shanghai/coworking' : '/coworking')
  })

  test('没有类型行、没有单位行、没有底栏计数；标题是共享办公', async ({ page }) => {
    await page.goto('/coworking')
    await expect(page.locator('h1')).toContainText('共享办公')
    await expect(page.locator('.ls-filterc__label', { hasText: '类型' })).toHaveCount(0)
    await expect(page.locator('.ls-unitband')).toHaveCount(0)
    await expect(page.locator('.ls-filterc__count')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('符合条件')
  })

  test('带筛选的 canonical 不含 type，且 ?type= 被锁定覆盖', async ({ page }) => {
    const response = await page.goto('/coworking?areaMin=100&type=full-floor&unknown=drop')
    expect(response?.status()).toBe(200)
    await expectCanonical(page, routingEnabled ? '/shanghai/coworking?areaMin=100' : '/coworking?areaMin=100')
    const filterHrefs = await page.locator('.ls-filterc a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    expect(filterHrefs.every((h) => !h.includes('type='))).toBe(true)
  })

  test('主导航「共享办公」指向频道', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('header a', { hasText: '共享办公' }).first()
    await expect(link).toHaveAttribute('href', routingEnabled ? '/shanghai/coworking' : '/coworking')
  })

  test('页面加载无客户端报错', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/coworking')
    await page.waitForLoadState('networkidle')
    expect(errors, `客户端报错：${errors.join(' | ')}`).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 本地单跑这一个 spec**

先按 `tests/e2e/` 既有 README / `playwright.config.ts` 的方式起 `next start`（CI 等价环境，见 memory：`CI=1` + https `SITE_URL`，否则房源路由 404），然后：
Run: `pnpm exec playwright test tests/e2e/coworking-channel.spec.ts tests/e2e/sale-channel.spec.ts`
Expected: PASS。**不要本地跑全量 E2E**（会被 SIGKILL）。

- [ ] **Step 4: 全量闸门**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 三项全绿。任何红灯先修再进 Task 9。

- [ ] **Step 5: 提交**

```bash
git add tests/e2e/coworking-channel.spec.ts
git commit -m "test(e2e): 共享办公频道冒烟"
```

---

### Task 9: 浏览器走查 + 证据 + Task Packet 收口

**Files:**
- Create: `artifacts/verification/OPT-103/README.md` + 截图
- Modify: `specs/work-items/OPT-103-list-filter-slim-coworking-channel.md`（状态行与 §5 复选框）
- Modify: `.claude/launch.json`（加 `opt103-dev` 条目，`--dir E:/wt-lsopt/payload-office-platform`，端口 3731）

- [ ] **Step 1: 起 dev 并走查（Claude Browser pane，`preview_start` name=`opt103-dev`）**

每个页面 @1440 与 375 各截一张，并用 `innerText` 核对文案（不用低分辨率截图读中文）：
1. `/shanghai/buildings`：筛选行 = 位置/等级/地铁/在租面积/竣工年代，无「在租状态」；底栏无「符合条件」；点「静安」后出现「商圈」行；再点某商圈后「位置」行其余区计数不为 0；点别的区 → 商圈条件消失。
2. `/shanghai/buildings?onlyWithStock=1`：底栏出现「在租状态：仅看有在租 ×」chip，点 × 后 URL 无 onlyWithStock。
3. `/shanghai/listings` 与 `/shanghai/sale`：无「租金单位 / 计价单位」行、无「符合条件」；工具条排序只有推荐/最新。
4. `/shanghai/listings?priceUnit=rmb-sqm-day`：仍有「租金上限」行与价格排序，无单位分段、无「另有 N 套」提示条。
5. `/shanghai/coworking`：标题「上海共享办公」；无类型行、无单位行、无底栏（未选条件时）；卡片全是共享办公；点位置筛选后 URL 不带 type；移动端抽屉无「类型」组。
6. 首页与页头：主导航「共享办公」、页脚「联合办公」、类型卡「联合办公」都指 `/shanghai/coworking`。

- [ ] **Step 2: 写证据**

`artifacts/verification/OPT-103/README.md`：每条走查一行「页面 / 断言 / 结果 / 截图文件名」，附 typecheck / lint / test 的最后三行输出与 E2E 单跑结果。

- [ ] **Step 3: 收口 Task Packet**

状态行改为「**已实施，待合并**」，§5 复选框按实际结果勾选；未验到的项如实写「未验到 + 原因」。

- [ ] **Step 4: 提交**

```bash
git add artifacts/verification/OPT-103 specs/work-items/OPT-103-list-filter-slim-coworking-channel.md .claude/launch.json
git commit -m "docs(opt-103): 走查证据与 Task Packet 收口"
```

---

## 自审记录

- **规格覆盖**：§2.1（Task 1/2/4）、§2.2（Task 5）、§2.3（Task 5/6/7）、§2.4（Task 3）、§3.4 不做的事（无任务动 `onlyWithStock` / `priceUnit` 域层、collections、globals）、§4 测试（Task 1–8）、§4.3 走查（Task 9）。
- **类型一致**：`channel` 名称在 Task 5/6/测试里一致；`lockCoworkingInput` / `buildCoworkingCanonicalParams` / `coworkingChannelPath` 三个名字在 Task 5/6 一致；`facets.businessAreas` / `dimensionHits.businessArea` 在 Task 1/2/4 一致；`countActivePicks(rows)` 单参在 Task 3/4/5 一致。
- **与规格的一处细化**：`?priceUnit=` 老链接下页头副题改为「共 N 套按 X 报价的在租房源」，不再有「其中 N 套价格面议、未计入上方单位计数」（那句指向已删控件）；`ExcludedUnitsBar` 恒不渲染。规格 §2.2 表末行据此同步修订。
