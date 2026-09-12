# OPT-096 建筑形态字段 + 导航二级菜单 + 楼盘出售口径 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 房源新增独立多选字段「建筑形态」（独栋 / 双排 / 联排），后台可维护、C 端列表可筛、详情参数表可见；② 主导航「找办公室」「找楼盘」各带「租赁 / 出售」二级菜单，「找楼盘 → 出售」落到新增的楼盘列表出售口径 `/buildings?business=sale`。规格：`specs/work-items/OPT-096-building-form-and-nav-submenu.md`。

**Architecture:** 两个独立半区，同一分支顺序实施。A 区（Task 1–4）：域层枚举 → collection 字段 + 一条迁移（含站点设置显隐列）→ 详情 DTO / 参数表 resolver → 列表 `form` 参数贯穿 URL 解析 / 扫描行 / facet / 筛选行 / 城市切换。B 区（Task 5–8）：`nav-submenu.ts`（零 import）按目标 href 挂固定子项 → `SiteNav` 桌面 CSS 下拉 + 抽屉缩进 → 楼盘搜索 `business=sale` 贯穿解析 / 聚合 / 缓存键 / 城市切换 → 楼盘页文案与卡片量词按 scope 切换。Task 9 闸门 + 走查。

**Tech Stack:** Next.js 16 / React 19 / Payload 3.86（postgres adapter）/ Vitest 4 / Playwright / pnpm。工作树 `E:\wt-096`，分支 `feat/opt-096-building-form-nav-submenu-2db1`，dev 端口 3728，任务库 `sbh_dev_096`（已从夹具库 `postgres` 克隆，88/88 迁移）。

## Global Constraints

- 所有命令在 `E:\wt-096\payload-office-platform` 下用 **pnpm**；不得 `npm` / `yarn`。
- 禁止 `any` / `as any` / `@ts-ignore` / `@ts-nocheck`；外部输入 `unknown` 收窄。
- 提交只用**显式** `git add <路径>`；提交信息简体中文、类型前缀 `feat` / `fix` / `docs`；**不加署名行**。
- `src/payload-types.ts` 生成物不入库；改 `Listings.ts` 后必须 `pnpm generate:types`。迁移 `.ts` + `.json` 成对入库，`src/migrations/index.ts` 由 `migrate:create` 自动更新。
- **不动** `listingType` 枚举、标签、前台「独栋办公」映射；**不动**筛选行的单选交互（多选是字段能力，URL 层 `form` 接受多值）；**不做**后台可配子菜单；**不做**供给导入模板列。
- 三个取值固定：`detached`=独栋、`double-row`=双排、`townhouse`=联排。URL 参数名 `form`。楼盘出售口径参数 `business=sale`（只认这一个值）。
- 每个任务完成后跑 `pnpm typecheck` 与该任务的测试文件；Task 9 再跑 `lint` / `test:changed` / `migrate:dry-run` / 浏览器。
- 中文文案简体。

---

## Part A：建筑形态

### Task 1: 域枚举 + `Listings.buildingForm` + 登记表项 + 迁移

**Files:**
- Modify: `src/domain/review/listing-fields.ts:44-58`（`LISTING_TYPES` 之后）
- Modify: `src/collections/Listings.ts:412-449`（基本信息第二个 `row` 之后加第三个 `row`）
- Modify: `src/lib/frontend/detail-spec/fields.ts:100-108`（`LISTING_SPEC_FIELDS` 的 `space` 组）
- Modify: `tests/opt083-detail-spec-registry.test.ts:57-70`
- Create: `tests/opt096-building-form.test.ts`
- Create（由命令生成）: `src/migrations/<时间戳>_opt_096_building_form.ts` + `.json`；`src/migrations/index.ts` 自动更新

**Interfaces:**
- Produces: `BUILDING_FORMS = ['detached','double-row','townhouse'] as const`、`type BuildingForm`、`BUILDING_FORM_LABELS: Record<BuildingForm,string>`、`isBuildingForm(value: unknown): value is BuildingForm`（`@/domain/review/listing-fields`）；`Listing['buildingForm']: ('detached'|'double-row'|'townhouse')[] | null`（生成类型）；登记表 key `buildingForm`（label「建筑形态」，组 `space`，默认可见）；DB：`listings_building_form` 子表 + `enum_listings_building_form`，`site_settings.detail_spec_fields_listing_building_form boolean DEFAULT true`。

- [ ] **Step 1: 写失败测试**

`tests/opt096-building-form.test.ts`：

```ts
/**
 * OPT-096：房源「建筑形态」多选字段的域层契约。
 */
import { describe, expect, it } from 'vitest'
import { Listings } from '@/collections/Listings'
import { BUILDING_FORMS, BUILDING_FORM_LABELS, isBuildingForm } from '@/domain/review/listing-fields'
import { LISTING_SPEC_FIELDS } from '@/lib/frontend/detail-spec/fields'

/** 从 collection 配置里按 name 深度查找字段（跨 tabs / row / group）。 */
function findField(fields: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(fields)) return null
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as Record<string, unknown>
    if (field.name === name) return field
    for (const key of ['fields', 'tabs']) {
      const nested = findField(field[key], name)
      if (nested) return nested
    }
  }
  return null
}

describe('OPT-096 建筑形态：域枚举', () => {
  it('三个取值与中文标签', () => {
    expect(BUILDING_FORMS).toEqual(['detached', 'double-row', 'townhouse'])
    expect(BUILDING_FORM_LABELS).toEqual({ detached: '独栋', 'double-row': '双排', townhouse: '联排' })
  })

  it('isBuildingForm 只认三个取值', () => {
    expect(isBuildingForm('detached')).toBe(true)
    expect(isBuildingForm('townhouse')).toBe(true)
    expect(isBuildingForm('serviced-office')).toBe(false)
    expect(isBuildingForm(null)).toBe(false)
    expect(isBuildingForm(1)).toBe(false)
  })
})

describe('OPT-096 建筑形态：Listings 字段', () => {
  it('是非必填的多选 select，选项由枚举生成', () => {
    const field = findField(Listings.fields, 'buildingForm')
    expect(field).not.toBeNull()
    expect(field?.type).toBe('select')
    expect(field?.hasMany).toBe(true)
    expect(field?.required).toBeUndefined()
    const options = (field?.options as Array<{ value: string; label: string }>).map((o) => [o.value, o.label])
    expect(options).toEqual([['detached', '独栋'], ['double-row', '双排'], ['townhouse', '联排']])
  })

  it('不参与发布完整度（不带 publishRequired 标记）', () => {
    const field = findField(Listings.fields, 'buildingForm')
    const custom = (field?.custom ?? {}) as Record<string, unknown>
    expect(custom.publishRequired).toBeUndefined()
  })
})

describe('OPT-096 建筑形态：详情参数登记表', () => {
  it('space 组里有 buildingForm，默认可见', () => {
    const entry = LISTING_SPEC_FIELDS.find((f) => f.key === 'buildingForm')
    expect(entry).toEqual({ key: 'buildingForm', label: '建筑形态', group: 'space', defaultVisible: true })
  })
})
```

`markPublishRequired` 是否用 `custom.publishRequired` 标记：执行时先 `rg -n "function markPublishRequired" src/collections/Listings.ts -A 6` 看清；若标记名不同，把上面 `custom.publishRequired` 改成实际键名。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt096-building-form.test.ts
```
Expected: FAIL（`BUILDING_FORMS` 未导出 / 字段为 null / 登记表无此项）。

- [ ] **Step 3: 域枚举**

`src/domain/review/listing-fields.ts` 在 `isListingType` 函数之后追加：

```ts
/**
 * 建筑形态（OPT-096）。**独立于 `listingType`**：一套房源可同时是「独栋 + 联排」，
 * 所以是多选；与 `serviced-office` 在 C 端显示为「独栋办公」互不干扰——那是业态，
 * 这是建筑物理形态。取值集合与 DB ENUM `enum_listings_building_form` 一致。
 */
export const BUILDING_FORMS = ['detached', 'double-row', 'townhouse'] as const
export type BuildingForm = (typeof BUILDING_FORMS)[number]

export const BUILDING_FORM_LABELS: Record<BuildingForm, string> = {
  detached: '独栋',
  'double-row': '双排',
  townhouse: '联排',
}

export function isBuildingForm(value: unknown): value is BuildingForm {
  return typeof value === 'string' && (BUILDING_FORMS as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Listings 字段**

`src/collections/Listings.ts`：import 行里加 `BUILDING_FORMS, BUILDING_FORM_LABELS`（与 `LISTING_TYPES` 同一条 `from '@/domain/review/listing-fields'`）。在「租售类型 / 装修状态 / 工商注册状态」那个 `row` 的闭合 `},` 之后、`name: 'slug'` 字段之前插入：

```ts
            {
              type: 'row',
              fields: [
                {
                  name: 'buildingForm',
                  label: '建筑形态',
                  type: 'select',
                  hasMany: true,
                  admin: {
                    width: COL_3,
                    description: '可多选。独栋 / 双排 / 联排；与「类型」互不干扰，不填不影响发布。',
                  },
                  options: BUILDING_FORMS.map((value) => ({
                    label: BUILDING_FORM_LABELS[value],
                    value,
                  })),
                },
              ],
            },
```

- [ ] **Step 5: 登记表项**

`src/lib/frontend/detail-spec/fields.ts` `LISTING_SPEC_FIELDS` 里 `{ key: 'divisible', ... }` 之后插入：

```ts
  { key: 'buildingForm', label: '建筑形态', group: 'space', defaultVisible: true },
```

`tests/opt083-detail-spec-registry.test.ts`：`LISTING_EXPECTED` 的 space 组数组末尾加 `'建筑形态'`；「共 24 项：22 项默认可见」改为 25 / 23（把 `toHaveLength(24)` 改 25，若有 `filter(defaultVisible).length` 断言 22 改 23——执行时读该 it 块）。

- [ ] **Step 6: 生成类型 + 迁移**

```bash
cd /e/wt-096/payload-office-platform && pnpm generate:types && grep -c '"prefix"' src/payload-types.ts && pnpm exec payload migrate:create opt_096_building_form 2>&1 | tail -5 && ls src/migrations | tail -3
```
Expected: `prefix` 计数 2；生成 `src/migrations/<ts>_opt_096_building_form.ts` + `.json`；`index.ts` 多一条。

打开生成的 `.ts`，`up()` 应包含（顺序可能不同）：`CREATE TYPE "public"."enum_listings_building_form" AS ENUM('detached', 'double-row', 'townhouse')`、`CREATE TABLE "listings_building_form" ("order" integer NOT NULL, "parent_id" integer NOT NULL, "value" "enum_listings_building_form", "id" serial PRIMARY KEY NOT NULL)`、`ALTER TABLE "listings_building_form" ADD CONSTRAINT ... FOREIGN KEY ("parent_id") REFERENCES "public"."listings"("id") ON DELETE cascade`、两条 `CREATE INDEX`（order / parent）、`ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_building_form" boolean DEFAULT true`。**若 diff 里出现与本任务无关的 DDL（别的分支遗留），停下核对 `sbh_dev_096` 的迁移状态，不要把无关变更带进本迁移。**

- [ ] **Step 7: 应用迁移 + 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm exec payload migrate 2>&1 | tail -3 && pnpm migrate:dry-run 2>&1 | tail -4 && pnpm vitest run tests/opt096-building-form.test.ts tests/opt083-detail-spec-registry.test.ts tests/opt083-detail-spec-settings-coverage.test.ts && pnpm typecheck
```
Expected: 迁移 1 条执行；dry-run 本迁移无禁用模式；三个测试文件 passed；typecheck 无输出。

- [ ] **Step 8: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/domain/review/listing-fields.ts payload-office-platform/src/collections/Listings.ts payload-office-platform/src/lib/frontend/detail-spec/fields.ts payload-office-platform/src/migrations/ payload-office-platform/tests/opt096-building-form.test.ts payload-office-platform/tests/opt083-detail-spec-registry.test.ts && git commit -m "feat(listings): 新增「建筑形态」多选字段（独栋 / 双排 / 联排）与详情参数登记项，附迁移（OPT-096）"
```

---

### Task 2: 详情 DTO 映射 + 参数表 resolver

**Files:**
- Modify: `src/domain/public-catalog/contracts.ts:377-386`（`ListingDetailViewModel`）
- Modify: `src/domain/public-catalog/mappers.ts` `mapListingDetail`（返回对象）
- Modify: `src/lib/frontend/detail-spec/listing-rows.ts:30-33`（`ListingSpecContext`）与 `LISTING_SPEC_RESOLVERS`
- Test: `tests/frontend-mappers.test.ts`（`describe('mapListingDetail')` 内）、`tests/opt096-building-form.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `isBuildingForm` / `BUILDING_FORM_LABELS`。
- Produces: `ListingDetailViewModel.buildingForm: readonly BuildingForm[]`（去重、过滤非法值、无值为空数组）；`ListingSpecContext` 多 `'buildingForm'`；resolver `buildingForm: (ctx) => ctx.buildingForm.length ? labels.join('、') : null`。

- [ ] **Step 1: 写失败测试**

`tests/frontend-mappers.test.ts` `describe('mapListingDetail')` 末尾追加：

```ts
  it('buildingForm：过滤非法值、去重、缺省为空数组（OPT-096）', () => {
    const withForms = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      buildingForm: ['townhouse', 'detached', 'townhouse', 'nope'],
    } as unknown as typeof LISTING_MONTHLY_STANDARD)
    expect(withForms?.buildingForm).toEqual(['townhouse', 'detached'])
    expect(mapListingDetail({ ...LISTING_MONTHLY_STANDARD, buildingForm: null })?.buildingForm).toEqual([])
    expect(mapListingDetail(LISTING_MONTHLY_STANDARD)?.buildingForm).toEqual([])
  })
```

`tests/opt096-building-form.test.ts` 追加：

```ts
import { buildListingOverviewGroupsFromRegistry, type ListingSpecContext } from '@/lib/frontend/detail-spec/listing-rows'

describe('OPT-096 建筑形态：详情参数表行', () => {
  const base: ListingSpecContext = { factGroups: [], price: null, availableFrom: null, building: null, buildingForm: [] }
  const rowOf = (ctx: ListingSpecContext) =>
    buildListingOverviewGroupsFromRegistry(ctx).flatMap((g) => g.rows).find((r) => r.label === '建筑形态')

  it('有值时按「、」拼中文标签', () => {
    expect(rowOf({ ...base, buildingForm: ['detached', 'townhouse'] })?.value).toBe('独栋、联排')
  })

  it('无值时该行不渲染', () => {
    expect(rowOf(base)).toBeUndefined()
  })

  it('站点设置关掉后不渲染', () => {
    const groups = buildListingOverviewGroupsFromRegistry({ ...base, buildingForm: ['detached'] }, { buildingForm: false })
    expect(groups.flatMap((g) => g.rows).some((r) => r.label === '建筑形态')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/frontend-mappers.test.ts -t "buildingForm" ; pnpm vitest run tests/opt096-building-form.test.ts -t "参数表行"
```
Expected: 两处 FAIL（`buildingForm` 为 undefined / 找不到 resolver）。

- [ ] **Step 3: 契约 + mapper**

`src/domain/public-catalog/contracts.ts` `ListingDetailViewModel` 里 `seats: number | null` 之后加：

```ts
  /** 建筑形态（OPT-096）：多选、可空；只进详情 DTO，不进卡片（OPT-047 体积红线）。 */
  buildingForm: readonly BuildingForm[]
```
并在文件顶部 `import type { BuildingForm } from '@/domain/review/listing-fields'`（contracts.ts 已 import `Listing` 等类型，同样是 `import type`，不引入运行时依赖）。

`src/domain/public-catalog/mappers.ts` 顶部 import `isBuildingForm` from `'@/domain/review/listing-fields'`（若该文件已 import 该模块则并入）；`mapListingDetail` 返回对象里 `seats:` 之后加：

```ts
    buildingForm: Array.from(
      new Set((Array.isArray(listing.buildingForm) ? listing.buildingForm : []).filter(isBuildingForm)),
    ),
```

- [ ] **Step 4: resolver**

`src/lib/frontend/detail-spec/listing-rows.ts`：`ListingSpecContext` 的 Pick 加 `'buildingForm'`；顶部 `import { BUILDING_FORM_LABELS } from '@/domain/review/listing-fields'`；`LISTING_SPEC_RESOLVERS` 里 `divisible:` 之后加：

```ts
  // OPT-096：多选拼「、」；空数组 → null（行不渲染），与「没值就不显这行」同一规则。
  buildingForm: (ctx) =>
    ctx.buildingForm.length > 0 ? ctx.buildingForm.map((form) => BUILDING_FORM_LABELS[form]).join('、') : null,
```

`ListingOverviewPanel` 把整份 `listing` 作 ctx 传入（执行时 `rg -n "buildListingOverviewGroupsFromRegistry\(" src/components` 确认），DTO 已带 `buildingForm`，无需改调用点。

- [ ] **Step 5: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/frontend-mappers.test.ts tests/opt096-building-form.test.ts tests/opt083-detail-spec-hiding.test.ts tests/opt083-detail-spec-wiring.test.ts tests/listing-overview-panel.test.ts tests/listing-card-payload-size.test.ts && pnpm typecheck
```
Expected: 全 passed（`listing-card-payload-size` 证明卡片没多带字段）；typecheck 无输出。若 `opt083-detail-spec-*` 里有按 ctx 字面量构造的用例因缺 `buildingForm` 报类型错，给它们补 `buildingForm: []`。

- [ ] **Step 6: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/domain/public-catalog/contracts.ts payload-office-platform/src/domain/public-catalog/mappers.ts payload-office-platform/src/lib/frontend/detail-spec/listing-rows.ts payload-office-platform/tests/frontend-mappers.test.ts payload-office-platform/tests/opt096-building-form.test.ts && git commit -m "feat(catalog): 房源详情 DTO 与概况参数表加入「建筑形态」（OPT-096）"
```
（若 Step 5 改了 opt083 测试文件，一并 `git add`。）

---

### Task 3: 列表 `form` 参数：解析 / canonical / 扫描行 / facet

**Files:**
- Modify: `src/domain/public-catalog/types.ts:58-64`（`ListingSearchInput`）
- Modify: `src/domain/public-catalog/search-params.ts:33-38`、`parseListingSearchInput`、`buildCanonicalSearchParams`
- Modify: `src/domain/public-catalog/facade.ts:131-136`（`SearchFacets`）、`ListingSearchDimension`、`omitListingSearchDimensions`
- Modify: `src/domain/public-catalog/listing-scan.ts`（row 类型、`SCAN_MEMORY_DIMENSIONS`、`toScanInput`、`rowFromListing`、`applyMemoryFilters`、`computeFacets`、`ScanFacets`）
- Modify: `src/domain/public-catalog/supply-adapter.ts:326-339`（`LISTING_SCAN_SELECT`）与 `buildListingWhere`（698 行附近）
- Test: `tests/opt068-listing-scan.test.ts`

**Interfaces:**
- Produces: `ListingSearchInput.buildingForm?: readonly string[]`；URL `form`（多值，白名单 `BUILDING_FORMS`）；`ListingSearchDimension` 多 `'buildingForm'`；`ListingScanRow.buildingForm: readonly string[]`；`ScanFacets.buildingForms` / `SearchFacets.buildingForms: ReadonlyArray<{ value: string; count: number }>`；内存过滤语义：行的 form 与 input 有交集即命中。

- [ ] **Step 1: 写失败测试**

`tests/opt068-listing-scan.test.ts`：`row()` 工厂里加 `buildingForm: []`（默认），在「内存过滤与 facet」describe 里追加：

```ts
  it('OPT-096：按建筑形态过滤——行与输入有交集即命中，多值 form 是并集', () => {
    const formed = [
      row({ id: 11, buildingForm: ['detached'] }),
      row({ id: 12, buildingForm: ['townhouse', 'double-row'] }),
      row({ id: 13 }),
    ]
    expect(ids(applyMemoryFilters(formed, parse('form=detached')))).toEqual([11])
    expect(ids(applyMemoryFilters(formed, parse('form=detached&form=double-row')))).toEqual([11, 12])
    expect(ids(applyMemoryFilters(formed, parse('form=nope')))).toEqual([11, 12, 13])
  })

  it('OPT-096：facet 统计每个形态出现的行数（一行多形态各计一次）', () => {
    const formed = [
      row({ id: 11, buildingForm: ['detached'] }),
      row({ id: 12, buildingForm: ['townhouse', 'detached'] }),
      row({ id: 13 }),
    ]
    expect(computeFacets(formed).buildingForms).toEqual([
      { value: 'detached', count: 2 },
      { value: 'townhouse', count: 1 },
    ])
  })

  it('OPT-096：form 是内存维度——扫描输入剥掉它、canonical 原样输出', () => {
    const input = parse('form=detached&form=townhouse&district=jingan')
    expect(input.buildingForm).toEqual(['detached', 'townhouse'])
    expect(toScanInput(input).buildingForm).toBeUndefined()
    expect(buildCanonicalSearchParams(input).getAll('form')).toEqual(['detached', 'townhouse'])
    expect(SCAN_MEMORY_DIMENSIONS).toContain('buildingForm')
  })
```

在「从 depth 2 文档投影行」describe 里追加：

```ts
  it('OPT-096：buildingForm 数组原样投影，非数组 → []', () => {
    expect(rowFromListing({ ...raw, buildingForm: ['detached', 'townhouse'] })?.buildingForm).toEqual(['detached', 'townhouse'])
    expect(rowFromListing({ ...raw, buildingForm: null })?.buildingForm).toEqual([])
    expect(rowFromListing(raw)?.buildingForm).toEqual([])
  })
```

顶部 import 补 `toScanInput, SCAN_MEMORY_DIMENSIONS, computeFacets, rowFromListing`（已 import 的不重复）与 `buildCanonicalSearchParams` from `'@/domain/public-catalog'`。`raw` 是该 describe 已有的文档夹具变量名，执行时核对。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt068-listing-scan.test.ts -t "OPT-096"
```
Expected: 4 条 FAIL。

- [ ] **Step 3: 类型与解析**

`src/domain/public-catalog/types.ts` `ListingSearchInput` 里 `listingType?: readonly string[]` 之后加：

```ts
  /** 建筑形态（OPT-096）。URL `form`，多值取并集；白名单见 search-params.ts。 */
  buildingForm?: readonly string[]
```

`src/domain/public-catalog/search-params.ts`：顶部 `import { BUILDING_FORMS } from '@/domain/review/listing-fields'`；`LISTING_TYPE_WHITELIST` 之后加 `const BUILDING_FORM_WHITELIST = new Set<string>(BUILDING_FORMS)`；`parseListingSearchInput` 里 `const listingType = ...` 之后加 `const buildingForm = parseWhitelistedArray(sp, 'form', BUILDING_FORM_WHITELIST)`，返回对象里 `listingType,` 之后加 `buildingForm,`；`buildCanonicalSearchParams` 里 `type` 那行之后加 `if (input.buildingForm) for (const v of input.buildingForm) sp.append('form', v)`。

- [ ] **Step 4: facade 维度 + facets 类型**

`src/domain/public-catalog/facade.ts`：`SearchFacets` 加 `buildingForms: ReadonlyArray<{ value: string; count: number }>`（`listingTypes` 之后）；`ListingSearchDimension` 联合加 `| 'buildingForm'`（`'listingType'` 之后）；`omitListingSearchDimensions` 里 `if (drop.has('listingType')) delete next.listingType` 之后加 `if (drop.has('buildingForm')) delete next.buildingForm`。

- [ ] **Step 5: 扫描行**

`src/domain/public-catalog/listing-scan.ts`：
- `ListingScanRow` 加 `buildingForm: readonly string[]`（`listingType` 之后）；
- `ScanFacets` 加 `buildingForms: ReadonlyArray<{ value: string; count: number }>`；
- `ScanMemoryDimension` 联合加 `'buildingForm'`，`SCAN_MEMORY_DIMENSIONS` 数组加 `'buildingForm'`；
- `toScanInput` 里 `delete next.listingType` 之后加 `delete next.buildingForm`；
- `rowFromListing` 返回对象 `listingType:` 之后加：
  ```ts
    buildingForm: Array.isArray(raw.buildingForm)
      ? raw.buildingForm.filter((v): v is string => typeof v === 'string')
      : [],
  ```
- `applyMemoryFilters`：`const types = ...` 之后加 `const forms = input.buildingForm && input.buildingForm.length > 0 ? new Set(input.buildingForm) : null`；filter 里 `if (types && ...) return false` 之后加 `if (forms && !row.buildingForm.some((f) => forms.has(f))) return false`；
- `computeFacets`：加 `const buildingFormCounts = new Map<string, number>()`，循环里 `if (row.listingType) {...}` 之后加 `for (const form of row.buildingForm) buildingFormCounts.set(form, (buildingFormCounts.get(form) ?? 0) + 1)`，返回对象加 `buildingForms: Array.from(buildingFormCounts.entries()).map(([value, count]) => ({ value, count }))`。

- [ ] **Step 6: 适配器**

`src/domain/public-catalog/supply-adapter.ts`：`LISTING_SCAN_SELECT` 里 `listingType: true,` 之后加 `buildingForm: true,`；`buildListingWhere` 里 `where.listingType = { in: [...] }` 那个 if 之后加：

```ts
    if (input.buildingForm && input.buildingForm.length > 0) {
      where.buildingForm = { in: [...input.buildingForm] }
    }
```

- [ ] **Step 7: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt068-listing-scan.test.ts tests/public-catalog-facade.test.ts tests/filter-unknown-vocabulary-values.test.ts tests/listing-price-unit-gate.test.ts && pnpm typecheck
```
Expected: 全 passed；typecheck 无输出（`ScanFacets`/`SearchFacets` 加了必填字段，若有测试用字面量构造它们，补 `buildingForms: []`）。

- [ ] **Step 8: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/domain/public-catalog/types.ts payload-office-platform/src/domain/public-catalog/search-params.ts payload-office-platform/src/domain/public-catalog/facade.ts payload-office-platform/src/domain/public-catalog/listing-scan.ts payload-office-platform/src/domain/public-catalog/supply-adapter.ts payload-office-platform/tests/opt068-listing-scan.test.ts && git commit -m "feat(catalog): 房源搜索加 form（建筑形态）维度：解析、canonical、扫描行过滤与 facet（OPT-096）"
```
（若 Step 7 补了别的测试文件，一并 add。）

---

### Task 4: 筛选行 + 列表页接线 + 城市切换保留 `form`

**Files:**
- Modify: `src/lib/frontend/listing-display.ts`（加 `BUILDING_FORM_LABEL`）
- Modify: `src/lib/frontend/listing-filter-rows.ts:120-166`、`280-340`、`346-356`
- Modify: `src/components/frontend/city/CityListingsView.tsx:277-310`
- Modify: `src/lib/frontend/city-routes.ts:47-73`（`LISTING_QUERY_KEYS` 数组）、`315-330`（`appendCanonicalListingQuery`）
- Test: `tests/opt096-building-form.test.ts`（追加）、`tests/city-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `input.buildingForm`、`SearchFacets.buildingForms`。
- Produces: 筛选维度 `{ dimension: 'buildingForm', label: '建筑形态', paramKeys: ['form'] }`；筛选行 `{ key: 'form', label: '建筑形态', options }`；`buildListingFilterRows` 多一个可选参数 `buildingFormCounts?: ReadonlyMap<string, number>`；`LISTING_CLEARABLE_DIMENSIONS` 含 `'buildingForm'`；城市切换保留 `form`。

- [ ] **Step 1: 写失败测试**

`tests/opt096-building-form.test.ts` 追加：

```ts
import { buildListingFilterRows, LISTING_CLEARABLE_DIMENSIONS } from '@/lib/frontend/listing-filter-rows'
import { parseListingSearchInput } from '@/domain/public-catalog'
import { switchCityUrl } from '@/lib/frontend/city-routes'

describe('OPT-096 建筑形态：筛选行', () => {
  const parse = (q: string) => parseListingSearchInput(new URLSearchParams(q))
  const build = (q: string, counts: Array<[string, number]>) =>
    buildListingFilterRows({
      input: parse(q),
      districts: [],
      districtCounts: new Map(),
      typeCounts: new Map(),
      buildingFormCounts: new Map(counts),
      priceRowLabel: '租金上限',
      priceDimensionLabel: '租金',
    })

  it('行 key=form，0 计数的候选不渲染，已选项保留', () => {
    const { rows } = build('form=townhouse', [['detached', 3]])
    const formRow = rows.find((r) => r.key === 'form')
    expect(formRow?.label).toBe('建筑形态')
    expect(formRow?.activeValue).toBe('townhouse')
    expect(formRow?.options.map((o) => [o.value, o.label, o.count])).toEqual([
      ['detached', '独栋', 3],
      ['townhouse', '联排', undefined],
    ])
  })

  it('维度清单含 buildingForm，回显中文，且可被「清除全部」清掉', () => {
    const { dimensions } = build('form=double-row', [])
    const dim = dimensions.find((d) => d.dimension === 'buildingForm')
    expect(dim).toMatchObject({ label: '建筑形态', paramKeys: ['form'], active: true, activeText: '双排' })
    expect(LISTING_CLEARABLE_DIMENSIONS).toContain('buildingForm')
  })

  it('城市切换保留 form', () => {
    expect(switchCityUrl('/shanghai/listings?form=detached&page=3', 'hangzhou')).toBe('/hangzhou/listings?form=detached')
  })
})
```

`switchCityUrl` 的参数形状以 `tests/city-routes.test.ts` 现有用例为准（执行时看第 137 行那条怎么调），照抄调用方式。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt096-building-form.test.ts -t "筛选行"
```
Expected: 3 条 FAIL。

- [ ] **Step 3: 标签 + 筛选行**

`src/lib/frontend/listing-display.ts` 在 `LISTING_TYPE_LABEL` 之后加：

```ts
/** 建筑形态中文名（OPT-096），与域层 `BUILDING_FORM_LABELS` 同值；C 端不另起文案。 */
export const BUILDING_FORM_LABEL: Readonly<Record<string, string>> = {
  detached: '独栋',
  'double-row': '双排',
  townhouse: '联排',
}
```

`src/lib/frontend/listing-filter-rows.ts`：
- import `BUILDING_FORM_LABEL`（与 `LISTING_TYPE_LABEL` 同一条 import）；
- `buildListingFilterDimensions` 里 `const activeType = ...` 之后加 `const activeForm = firstOrUndefined(input.buildingForm)`；返回数组里 `listingType` 那项之后插入：
  ```ts
    {
      dimension: 'buildingForm',
      label: '建筑形态',
      paramKeys: ['form'],
      active: activeForm != null,
      activeText: enumLabel(activeForm, BUILDING_FORM_LABEL),
    },
  ```
- `buildListingFilterRows` 的 params 类型加 `buildingFormCounts?: ReadonlyMap<string, number>`，解构里取出（默认 `new Map()`）；`const activeType = ...` 之后加 `const activeForm = firstOrUndefined(input.buildingForm)`；`typeOptions` 之后加：
  ```ts
  const formOptions = (Object.keys(BUILDING_FORM_LABEL) as string[])
    .filter((value) => value === activeForm || (buildingFormCounts.get(value) ?? 0) > 0)
    .map((value) => ({
      value,
      label: BUILDING_FORM_LABEL[value],
      ...(buildingFormCounts.get(value) != null && buildingFormCounts.get(value)! > 0
        ? { count: buildingFormCounts.get(value)! }
        : {}),
    }))
  ```
  `rows` 数组里 `type` 行之后插入 `{ key: 'form', label: '建筑形态', options: formOptions, ...(activeForm ? { activeValue: activeForm } : {}) },`；
- `LISTING_CLEARABLE_DIMENSIONS` 里 `'listingType'` 之后加 `'buildingForm'`。

`enumLabel` 的签名若要求 `Record<K,string>` 泛型，`BUILDING_FORM_LABEL` 已是 `Record<string,string>`，可直接传。

- [ ] **Step 4: 列表页接线**

`src/components/frontend/city/CityListingsView.tsx`：`Promise.all` 数组里 `facetsOmitting(['listingType'])` 之后加 `facetsOmitting(['buildingForm'])`，解构名对应加 `formFacets`（放在 `typeFacets` 之后、`relaxationFacets` 之前，**位置要与数组顺序一致**）；`buildListingFilterRows({...})` 里 `typeCounts:` 之后加 `buildingFormCounts: toCountMap(formFacets.buildingForms),`。

移动筛选抽屉 `MobileFilterSheet` 与 `FilterFormC` 都按 `rows` 数据驱动渲染，无需改；执行时 `rg -n "'type'" src/components/frontend/listing/FilterFormC.tsx src/components/frontend/listing/MobileFilterSheet.tsx` 确认没有按 key 硬编码的行序。

- [ ] **Step 5: 城市切换**

`src/lib/frontend/city-routes.ts`：`LISTING_QUERY_KEYS`（含 `'priceMin'` 的那个 `as const` 数组）加 `'form'`；`appendCanonicalListingQuery` 里 `if (listingType) selected.set('type', listingType)` 之后加：

```ts
  const buildingForm = input.buildingForm?.[0]
  if (buildingForm) selected.set('form', buildingForm)
```

- [ ] **Step 6: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt096-building-form.test.ts tests/city-routes.test.ts tests/city-route-pages.test.ts tests/filter-unknown-vocabulary-values.test.ts && pnpm typecheck
```
Expected: 全 passed；typecheck 无输出。

- [ ] **Step 7: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/lib/frontend/listing-display.ts payload-office-platform/src/lib/frontend/listing-filter-rows.ts payload-office-platform/src/components/frontend/city/CityListingsView.tsx payload-office-platform/src/lib/frontend/city-routes.ts payload-office-platform/tests/opt096-building-form.test.ts && git commit -m "feat(listings): 列表页加「建筑形态」筛选行，城市切换保留 form（OPT-096）"
```

---

## Part B：导航二级菜单 + 楼盘出售口径

### Task 5: 导航子项数据层（`nav-submenu.ts`）

**Files:**
- Create: `src/lib/frontend/nav-submenu.ts`（**零 import**，客户端安全）
- Modify: `src/lib/frontend/public-nav.ts:14`（`PublicNavItem`）与 `MAIN_NAV_ITEMS`
- Modify: `src/lib/frontend/site-settings-view.ts:61`（`mainNav` 类型）、`108-116`（兜底）
- Modify: `src/lib/frontend/site-settings.ts:119-123`（`mapMainNav`）
- Create: `tests/opt096-nav-submenu.test.ts`

**Interfaces:**
- Produces: `PublicNavItem = { href; label; children?: readonly { href; label }[] }`；`NAV_SUBMENU_BY_HREF: Readonly<Record<string, readonly NavSubItem[]>>`（键 `/listings` / `/buildings`）；`attachMainNavSubmenu<T extends { href: string }>(items: readonly T[]): readonly (T & { children?: readonly NavSubItem[] })[]`；`SiteSettingsView.mainNav: readonly PublicNavItem[]`（含 children）。

- [ ] **Step 1: 写失败测试**

`tests/opt096-nav-submenu.test.ts`：

```ts
/**
 * OPT-096：主导航「找办公室 / 找楼盘」的固定二级菜单（代码规则，不走后台配置）。
 */
import { describe, expect, it } from 'vitest'
import { attachMainNavSubmenu, NAV_SUBMENU_BY_HREF } from '@/lib/frontend/nav-submenu'
import { MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'

describe('OPT-096 导航子项', () => {
  it('只有 /listings 与 /buildings 两个目标有子项，各自是租赁 / 出售', () => {
    expect(Object.keys(NAV_SUBMENU_BY_HREF).sort()).toEqual(['/buildings', '/listings'])
    expect(NAV_SUBMENU_BY_HREF['/listings']).toEqual([
      { href: '/listings', label: '租赁' },
      { href: '/sale', label: '出售' },
    ])
    expect(NAV_SUBMENU_BY_HREF['/buildings']).toEqual([
      { href: '/buildings', label: '租赁' },
      { href: '/buildings?business=sale', label: '出售' },
    ])
  })

  it('attachMainNavSubmenu 按 href 挂子项，其余项不带 children 键', () => {
    const out = attachMainNavSubmenu([
      { href: '/', label: '首页' },
      { href: '/listings', label: '找办公室（改过名）' },
      { href: '/listings?type=coworking', label: '共享办公' },
    ])
    expect(out[0]).toEqual({ href: '/', label: '首页' })
    expect(out[1]).toEqual({ href: '/listings', label: '找办公室（改过名）', children: NAV_SUBMENU_BY_HREF['/listings'] })
    expect(out[2]).toEqual({ href: '/listings?type=coworking', label: '共享办公' })
  })

  it('默认导航与站点设置兜底都已带子项', () => {
    const fromDefaults = MAIN_NAV_ITEMS.find((i) => i.href === '/buildings')
    const fromFallback = SITE_SETTINGS_FALLBACK.mainNav.find((i) => i.href === '/buildings')
    expect(fromDefaults?.children?.map((c) => c.label)).toEqual(['租赁', '出售'])
    expect(fromFallback?.children?.map((c) => c.label)).toEqual(['租赁', '出售'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt096-nav-submenu.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 新文件**

`src/lib/frontend/nav-submenu.ts`：

```ts
/**
 * 主导航固定二级菜单（OPT-096）。
 *
 * **代码规则，不是后台配置**：只有「找办公室」（目标 `/listings`）与「找楼盘」
 * （目标 `/buildings`）两项带「租赁 / 出售」子项。做成后台可配要数组套数组，
 * 且新目标要进 PG 枚举（见 nav-targets.ts「新增目标需要迁移」），本次不做。
 *
 * 按**目标 href** 而不是配置行 id 匹配：href 归代码（OPT-054 的护栏），运营改标签、
 * 改顺序、隐藏都不影响子项；把「找办公室」改指别的目标，子项也随之消失。
 *
 * 本文件**零 import**：`site-settings-view.ts`（客户端安全）与 `site-settings.ts`
 * （服务端）都要用它，任何 import 都可能把服务端依赖拖进浏览器包。
 */

export type NavSubItem = Readonly<{ href: string; label: string }>

export const NAV_SUBMENU_BY_HREF: Readonly<Record<string, readonly NavSubItem[]>> = {
  '/listings': [
    { href: '/listings', label: '租赁' },
    { href: '/sale', label: '出售' },
  ],
  '/buildings': [
    { href: '/buildings', label: '租赁' },
    { href: '/buildings?business=sale', label: '出售' },
  ],
}

/** 给主导航项挂子项；没有子项的项原样返回（不带 `children` 键）。 */
export function attachMainNavSubmenu<T extends Readonly<{ href: string }>>(
  items: readonly T[],
): readonly (T & Readonly<{ children?: readonly NavSubItem[] }>)[] {
  return items.map((item) => {
    const children = NAV_SUBMENU_BY_HREF[item.href]
    return children ? { ...item, children } : item
  })
}
```

- [ ] **Step 4: 类型与默认值**

`src/lib/frontend/public-nav.ts`：
- `import { attachMainNavSubmenu, type NavSubItem } from '@/lib/frontend/nav-submenu'`；
- `export type PublicNavItem = Readonly<{ href: string; label: string; children?: readonly NavSubItem[] }>`；
- `MAIN_NAV_ITEMS` 改为 `attachMainNavSubmenu([...原数组...] as const)`（保留原七项与顺序；`readonly PublicNavItem[]` 类型标注不变）。

`src/lib/frontend/site-settings-view.ts`：
- import `attachMainNavSubmenu` 与 `type PublicNavItem`（从 `'@/lib/frontend/public-nav'` 取类型即可，该文件已被客户端消费，安全）；
- `mainNav: ReadonlyArray<Readonly<{ href: string; label: string }>>` 改为 `mainNav: readonly PublicNavItem[]`；
- `SITE_SETTINGS_FALLBACK.mainNav` 的数组外面包 `attachMainNavSubmenu([...])`。

`src/lib/frontend/site-settings.ts` `mapMainNav`：

```ts
function mapMainNav(rows: unknown): SiteSettingsView['mainNav'] {
  const links = mapNavLinks(rows)
  // 全空回落到兜底：导航整条消失比显示旧配置糟得多——用户会以为站点坏了
  // OPT-096：子项在这里挂（按目标 href），页脚不挂——`mapNavLinks` 两边共用，不能在那里做。
  return links.length > 0 ? attachMainNavSubmenu(links) : SITE_SETTINGS_FALLBACK.mainNav
}
```
并 import `attachMainNavSubmenu`。

- [ ] **Step 5: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt096-nav-submenu.test.ts tests/public-nav.test.ts tests/nav-target-pool-coverage.test.ts tests/site-header-features.test.ts tests/nav-page-target.test.ts && pnpm typecheck
```
Expected: 全 passed（`public-nav.test.ts` 的「按固定顺序暴露 7 个入口」若用 `toEqual` 比整个对象会因多出 `children` 而红——把它改成比 `href`/`label` 投影，或 `toMatchObject`）；typecheck 无输出。

- [ ] **Step 6: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/lib/frontend/nav-submenu.ts payload-office-platform/src/lib/frontend/public-nav.ts payload-office-platform/src/lib/frontend/site-settings-view.ts payload-office-platform/src/lib/frontend/site-settings.ts payload-office-platform/tests/opt096-nav-submenu.test.ts && git commit -m "feat(nav): 主导航「找办公室 / 找楼盘」挂固定「租赁 / 出售」子项（数据层，OPT-096）"
```
（`public-nav.test.ts` 若改了，一并 add。）

---

### Task 6: `SiteNav` 桌面下拉 + 抽屉缩进 + 高亮判据

**Files:**
- Modify: `src/components/frontend/SiteNav.tsx:62-96`（`isCurrent`）、`203-220`（桌面）、`300-320`（抽屉）
- Modify: `src/app/(frontend)/styles.css:983`（`.site-nav__link` 之后加 `__group` / `__menu` / `__sub`）、`3366`（`.mobile-drawer__link` 之后加 `--sub`）
- Modify: `src/lib/frontend/city-routes.ts:554-563`（`cityAwareHref` 认 `sale`）
- Test: `tests/site-nav-current.test.ts`、`tests/opt096-nav-submenu.test.ts`（追加渲染断言）、`tests/city-routes.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `PublicNavItem.children`。
- Produces: 桌面 DOM `<div class="site-nav__group"><a class="site-nav__link" aria-haspopup="true">…</a><ul class="site-nav__menu"><li><a class="site-nav__sub">…</a></li></ul></div>`；抽屉 DOM 父项 `.mobile-drawer__link` 后紧跟子项 `.mobile-drawer__link.mobile-drawer__link--sub`；`isCurrent` 无 query 的 href 在当前 URL 带 `business` 时不高亮；父项在任一子项命中时高亮；`cityAwareHref('/sale', 'shanghai')` → `/shanghai/sale`。

- [ ] **Step 1: 写失败测试**

`tests/site-nav-current.test.ts` 追加（照该文件现有 `sp('...')` 或 `new URLSearchParams` 的写法）：

```ts
  it('OPT-096：无 query 的 href 在当前 URL 带 business 时不高亮（租赁子项不与出售子项同亮）', () => {
    expect(isCurrent('/shanghai/buildings', new URLSearchParams('business=sale'), '/shanghai/buildings')).toBe(false)
    expect(isCurrent('/shanghai/buildings', new URLSearchParams('business=sale'), '/shanghai/buildings?business=sale')).toBe(true)
    expect(isCurrent('/shanghai/buildings', new URLSearchParams(), '/shanghai/buildings')).toBe(true)
  })
```

`tests/opt096-nav-submenu.test.ts` 追加（复用 `tests/site-header-features.test.ts` 的 `vi.mock('next/navigation', …)` 与 `render()` 写法，pathname mock 成 `/shanghai/buildings`）：

```ts
  it('桌面：找办公室 / 找楼盘渲染为带下拉的分组，父项 aria-haspopup，子项城市前缀化', () => {
    const html = renderHeader()
    expect((html.match(/class="site-nav__group"/g) ?? []).length).toBe(2)
    expect(html).toMatch(/<a[^>]*href="\/shanghai\/listings"[^>]*class="site-nav__link"[^>]*aria-haspopup="true"/)
    expect(html).toContain('href="/shanghai/sale"')
    expect(html).toContain('href="/shanghai/buildings?business=sale"')
    expect((html.match(/class="site-nav__sub"/g) ?? []).length).toBe(4)
  })

  it('在 /shanghai/buildings 上：父项「找楼盘」与子项「租赁」高亮，「出售」不高亮', () => {
    const html = renderHeader()
    expect(html).toMatch(/href="\/shanghai\/buildings"[^>]*class="site-nav__link"[^>]*aria-current="page"/)
    expect(html).toMatch(/href="\/shanghai\/buildings"[^>]*class="site-nav__sub"[^>]*aria-current="page"/)
    expect(html).not.toMatch(/href="\/shanghai\/buildings\?business=sale"[^>]*aria-current="page"/)
  })
```

`renderHeader()`：在本测试文件里定义，`renderToStaticMarkup(createElement(SiteHeader, { cities: CITIES, defaultCity: 'shanghai', multiCityRoutingEnabled: true, brand: { siteName: '站', logo: null, mainNav: SITE_SETTINGS_FALLBACK.mainNav } }))`，`CITIES` 照 `site-header-features.test.ts` 的形状（含 `servicePhone: null`）。`vi.mock('next/navigation')` 的 `usePathname` 返回 `/shanghai/buildings`、`useSearchParams` 返回空。

`tests/city-routes.test.ts` 追加：

```ts
  it('OPT-096：cityAwareHref 给出售频道与楼盘出售口径加城市前缀', () => {
    expect(cityAwareHref('/sale', 'shanghai', true)).toBe('/shanghai/sale')
    expect(cityAwareHref('/buildings?business=sale', 'shanghai', true)).toBe('/shanghai/buildings?business=sale')
    expect(cityAwareHref('/buildings?business=sale', 'shanghai', false)).toBe('/buildings?business=sale')
  })
```
（第三条依赖 Task 7 的 `selectBuildingQuery` 保留 `business`；本任务先让前两条过，第三条在 Task 7 Step 5 一起变绿——执行时若它先红，属预期，Task 7 收。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/site-nav-current.test.ts tests/opt096-nav-submenu.test.ts tests/city-routes.test.ts -t "OPT-096|桌面|父项"
```
Expected: FAIL。

- [ ] **Step 3: `isCurrent` 与 `cityAwareHref`**

`SiteNav.tsx` `isCurrent` 最后一行改为：

```ts
  // href 无 query（如 /listings 总览）：仅当当前无 type / business 筛选时高亮——
  // OPT-096 起「租赁」子项就是无 query 的 /buildings，出售口径页上它不能跟「出售」同亮。
  return !searchParams.has('type') && !searchParams.has('business')
```
注释块里「href 无 query 时」那条同步加一句 business。

`city-routes.ts` `cityAwareHref`：`if (pageType === 'listings' || pageType === 'buildings')` 改为 `if (pageType === 'listings' || pageType === 'sale' || pageType === 'buildings')`。

- [ ] **Step 4: 桌面渲染**

`SiteNav.tsx` 桌面 `<nav className="site-nav">` 内 `items.map` 替换为：

```tsx
        {items.map((item) => {
          const href = citySlug ? cityAwareHref(item.href, citySlug, multiCityRoutingEnabled) : item.href
          const children = (item.children ?? []).map((child) => {
            const childHref = citySlug ? cityAwareHref(child.href, citySlug, multiCityRoutingEnabled) : child.href
            return { ...child, resolvedHref: childHref, current: isCurrent(pathname, searchParams, childHref) }
          })
          // OPT-096：任一子项命中时父项也高亮（/shanghai/sale 上「找办公室」要亮）
          const current = isCurrent(pathname, searchParams, href, item.href === '/') || children.some((c) => c.current)
          const link = (
            <Link
              href={href}
              prefetch={item.href.startsWith('/listings') ? false : undefined}
              className="site-nav__link"
              aria-current={current ? 'page' : undefined}
              aria-haspopup={children.length > 0 ? 'true' : undefined}
            >
              {item.label}
            </Link>
          )
          if (children.length === 0) return <React.Fragment key={item.href}>{link}</React.Fragment>
          // 下拉靠 CSS :hover / :focus-within 展开（styles.css .site-nav__group），
          // 不引入 state：父项本身仍是可点的链接，键盘 Tab 到父项即展开、继续 Tab 进子项。
          return (
            <div key={item.href} className="site-nav__group">
              {link}
              <ul className="site-nav__menu" aria-label={`${item.label}分类`}>
                {children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.resolvedHref}
                      prefetch={false}
                      className="site-nav__sub"
                      aria-current={child.current ? 'page' : undefined}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
```
文件顶部若未 `import React`，补 `import React from 'react'`（已有 `useEffect` 等具名导入的话改成 `import React, { useEffect, useRef, useState } from 'react'`）。

- [ ] **Step 5: 抽屉渲染**

抽屉 `<nav className="mobile-drawer__nav">` 内 `items.map` 替换为：

```tsx
              {items.map((item) => {
                const href = citySlug ? cityAwareHref(item.href, citySlug, multiCityRoutingEnabled) : item.href
                const current = isCurrent(pathname, searchParams, href, item.href === '/')
                const close = () => {
                  setOpen(false)
                  toggleRef.current?.focus()
                }
                return (
                  <React.Fragment key={item.href}>
                    <Link
                      href={href}
                      prefetch={item.href.startsWith('/listings') ? false : undefined}
                      className="mobile-drawer__link"
                      aria-current={current ? 'page' : undefined}
                      onClick={close}
                    >
                      {item.label}
                    </Link>
                    {/* OPT-096：子项紧跟父项、缩进一档；抽屉没有 hover，直接平铺 */}
                    {(item.children ?? []).map((child) => {
                      const childHref = citySlug ? cityAwareHref(child.href, citySlug, multiCityRoutingEnabled) : child.href
                      return (
                        <Link
                          key={child.href}
                          href={childHref}
                          prefetch={false}
                          className="mobile-drawer__link mobile-drawer__link--sub"
                          aria-current={isCurrent(pathname, searchParams, childHref) ? 'page' : undefined}
                          onClick={close}
                        >
                          {child.label}
                        </Link>
                      )
                    })}
                  </React.Fragment>
                )
              })}
```

- [ ] **Step 6: 样式**

`styles.css` 在 `.site-nav__link:hover { … }` 规则之后插入：

```css
/* OPT-096：主导航二级菜单。分组撑满顶栏高度（与 .site-nav__link 同 align-self:stretch），
   菜单贴分组底边（top:100%）——中间不留空隙，鼠标从父项滑到菜单不会掉出 :hover。
   键盘：父项是普通链接，Tab 到它即 :focus-within 展开，继续 Tab 进子项；Esc 不需要——
   焦点离开分组菜单即收起。 */
.site-nav__group {
  position: relative;
  display: inline-flex;
  align-items: center;
  align-self: stretch;
}

.site-nav__menu {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  min-width: 128px;
  margin: 0;
  padding: var(--sp-2);
  list-style: none;
  background: var(--bg-subtle);
  border: 1px solid var(--line);
  border-radius: var(--r-ctrl);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--duration-fast) var(--ease-standard), visibility 0s linear var(--duration-fast);
}

.site-nav__group:hover .site-nav__menu,
.site-nav__group:focus-within .site-nav__menu {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}

.site-nav__sub {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-input);
  color: var(--ink);
  font-size: var(--fs-14);
  white-space: nowrap;
  text-decoration: none;
}

.site-nav__sub:hover {
  background: var(--bg);
  text-decoration: none;
}

.site-nav__sub[aria-current="page"] {
  color: var(--accent);
  font-weight: 600;
}

/* 透明头（首页 hero）下：父项是白字，但下拉仍是白底深字 */
.site-header--transparent .site-nav__sub {
  color: var(--ink);
}
.site-header--transparent .site-nav__sub[aria-current="page"] {
  color: var(--accent);
}
```

`.mobile-drawer__link { … }` 规则之后插入：

```css
/* OPT-096：抽屉里的二级项——缩进一档、字号小一档、次要墨色 */
.mobile-drawer__link--sub {
  padding-left: calc(var(--sp-4) + var(--sp-5));
  font-size: var(--fs-14);
  color: var(--ink-2);
}
```

- [ ] **Step 7: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/site-nav-current.test.ts tests/opt096-nav-submenu.test.ts tests/site-header-features.test.ts tests/city-routes.test.ts && pnpm typecheck
```
Expected: 除 `city-routes` 第三条（Task 7 收）外全 passed；typecheck 无输出。E2E 自查：`rg -n "site-nav__link|mobile-drawer__link" tests/e2e/` —— 若有按「`.site-nav__link` 数量 = 7」之类的断言，本次桌面链接数不变（子项是 `.site-nav__sub`），抽屉 `.mobile-drawer__link` 会多 4 条，把对应计数断言改成只数非 `--sub` 的（`.mobile-drawer__link:not(.mobile-drawer__link--sub)`）。

- [ ] **Step 8: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/components/frontend/SiteNav.tsx "payload-office-platform/src/app/(frontend)/styles.css" payload-office-platform/src/lib/frontend/city-routes.ts payload-office-platform/tests/site-nav-current.test.ts payload-office-platform/tests/opt096-nav-submenu.test.ts payload-office-platform/tests/city-routes.test.ts && git commit -m "feat(nav): 桌面主导航 hover / focus 下拉与抽屉二级项，子项命中时父项高亮（OPT-096）"
```

---

### Task 7: 楼盘搜索出售口径（域层 + 缓存键 + 城市切换）

**Files:**
- Modify: `src/domain/public-catalog/building-search.ts:47-61`、`143-181`、`189-202`
- Modify: `src/domain/public-catalog/facade.ts:264-290`（`attachSupplyAggregates`）、`428-440`（`searchBuildings`）、`499`（`searchBuildingsFiltered` 调用）
- Modify: `src/lib/frontend/city-routes.ts:75`（`BUILDING_QUERY_KEYS`）、`365-370`（`selectBuildingQuery`）
- Test: `tests/opt036-building-search.test.ts`（解析 / canonical）、`tests/public-catalog-facade.test.ts`（出售口径聚合）、`tests/city-routes.test.ts`（Task 6 留下的第三条）

**Interfaces:**
- Produces: `BuildingSearchInput.business?: 'sale'`；URL `business=sale`；canonical 输出 `business=sale`（不是维度，不进 `BUILDING_CLEARABLE_DIMENSIONS`）；`searchBuildings(ctx, adapter?, business?: 'sale')`：`business==='sale'` 时聚合按 sale 且只保留 `listingCount > 0` 的楼盘；`searchBuildingsFiltered` 透传 `input.business`；城市切换保留 `business=sale`。

- [ ] **Step 1: 写失败测试**

`tests/opt036-building-search.test.ts` 追加（照该文件的 `parseBuildingSearchInput(new URLSearchParams(...))` 写法）：

```ts
  it('OPT-096：business 只认 sale，canonical 原样输出，不是可清除维度', () => {
    expect(parseBuildingSearchInput(new URLSearchParams('business=sale')).business).toBe('sale')
    expect(parseBuildingSearchInput(new URLSearchParams('business=lease')).business).toBeUndefined()
    expect(parseBuildingSearchInput(new URLSearchParams('business=x')).business).toBeUndefined()
    const input = parseBuildingSearchInput(new URLSearchParams('business=sale&grade=grade-a'))
    expect(buildBuildingCanonicalParams(input).toString()).toBe('grade=grade-a&business=sale')
    expect(BUILDING_CLEARABLE_DIMENSIONS).not.toContain('business')
    expect(omitBuildingSearchDimensions(input, BUILDING_CLEARABLE_DIMENSIONS).business).toBe('sale')
  })
```

`tests/public-catalog-facade.test.ts`：找到现有 `searchBuildingsFiltered` 或 `searchBuildings` 的用例，看它怎么造 `SupplyAdapter` 桩（`aggregateEffectiveSupplyByBuildings` 的桩），追加：

```ts
  it('OPT-096：出售口径按 sale 聚合，只列有在售房源的楼盘；租赁口径不受影响', async () => {
    const calls: Array<string | undefined> = []
    const adapter = {
      ...stubAdapter,
      findEffectiveBuildings: async () => [BUILDING_JINGAN_CENTER, BUILDING_PUDONG_WITH_CITY],
      aggregateEffectiveSupplyByBuildings: async (_ids: readonly (number | string)[], ctx: SearchContext) => {
        calls.push(ctx.businessType)
        return ctx.businessType === 'sale'
          ? new Map([[String(BUILDING_JINGAN_CENTER.id), { area: 800, count: 2 }]])
          : new Map([
              [String(BUILDING_JINGAN_CENTER.id), { area: 100, count: 1 }],
              [String(BUILDING_PUDONG_WITH_CITY.id), { area: 200, count: 3 }],
            ])
      },
    }
    const ctx = createSearchContext('shanghai')
    const sale = await searchBuildings(ctx, adapter, 'sale')
    expect(sale.docs.map((d) => [d.id, d.listingCount, d.leasableArea])).toEqual([[BUILDING_JINGAN_CENTER.id, 2, 800]])
    const lease = await searchBuildings(ctx, adapter)
    expect(lease.docs).toHaveLength(2)
    expect(calls).toEqual(['sale', 'lease'])
  })
```
`stubAdapter` 与楼盘夹具名以该测试文件现有内容为准（执行时 `rg -n "aggregateEffectiveSupplyByBuildings" tests/public-catalog-facade.test.ts`）。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt036-building-search.test.ts tests/public-catalog-facade.test.ts -t "OPT-096"
```
Expected: FAIL。

- [ ] **Step 3: building-search**

`BuildingSearchInput` 里 `onlyWithStock?: boolean` 之后加：

```ts
  /**
   * 出售口径（OPT-096）：只认 `'sale'`；缺省即租赁。**不是筛选维度**——它决定的是
   * 「在租 / 在售」这套口径本身（聚合、量词、分组），不进「清除全部」。
   */
  business?: 'sale'
```
`parseBuildingSearchInput`：`const onlyWithStock = ...` 之后加 `const business = sp.get('business') === 'sale' ? ('sale' as const) : undefined`；返回对象 `...(onlyWithStock != null ? { onlyWithStock } : {}),` 之后加 `...(business ? { business } : {}),`。
`buildBuildingCanonicalParams`：`if (input.onlyWithStock) …` 之后加 `if (input.business) sp.set('business', input.business)`。

- [ ] **Step 4: facade**

`attachSupplyAggregates` 签名加第四参 `business: 'lease' | 'sale' = 'lease'`，把 `{ ...ctx, businessType: 'lease' }` 改为 `{ ...ctx, businessType: business }`，并把那段「强制 lease 而非跟随 ctx」注释补一句：「OPT-096：楼盘列表出售口径由调用方**显式**传 `'sale'`，仍然不跟随 ctx——出售频道页上的楼盘卡片依旧是租赁口径。」

`searchBuildings`：

```ts
export async function searchBuildings(
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
  business: 'lease' | 'sale' = 'lease',
): Promise<BuildingSearchResult> {
  const rawBuildings = await adapter.findEffectiveBuildings(ctx)
  const summaries: BuildingSummaryViewModel[] = []
  for (const raw of rawBuildings) {
    const summary = mapBuildingSummary(raw)
    if (summary) summaries.push(summary)
  }
  const docs = await attachSupplyAggregates(summaries, ctx, adapter, business)
  // OPT-096 出售口径：只列有在售供给的楼盘。「暂无在售」不是一个有意义的目录分组
  // （出售起步期绝大多数楼盘都没有），列出来只会把一屏刷成紧凑行。
  const scoped = business === 'sale' ? docs.filter((doc) => (doc.listingCount ?? 0) > 0) : docs
  return { docs: scoped, totalDocs: scoped.length }
}
```
`searchBuildingsFiltered` 里 `searchBuildings(ctx, adapter)` 改为 `searchBuildings(ctx, adapter, input.business ?? 'lease')`。

- [ ] **Step 5: 城市切换**

`city-routes.ts`：`BUILDING_QUERY_KEYS = ['grade', 'business'] as const`；`selectBuildingQuery` 改为：

```ts
function selectBuildingQuery(params: URLSearchParams): URLSearchParams {
  const selected = new URLSearchParams()
  const grade = readSingle(params, 'grade')
  if (grade !== null && BUILDING_GRADE_VALUES.has(grade)) selected.set('grade', grade)
  // OPT-096：出售口径跟着城市走——换城市看的还是「在售楼盘」
  if (readSingle(params, 'business') === 'sale') selected.set('business', 'sale')
  return selected
}
```

- [ ] **Step 6: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt036-building-search.test.ts tests/public-catalog-facade.test.ts tests/city-routes.test.ts tests/opt036-building-search-result.test.ts tests/public-catalog-city-parity.test.ts && pnpm typecheck
```
Expected: 全 passed（含 Task 6 留下的 `cityAwareHref('/buildings?business=sale', 'shanghai', false)`）；typecheck 无输出。

- [ ] **Step 7: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/domain/public-catalog/building-search.ts payload-office-platform/src/domain/public-catalog/facade.ts payload-office-platform/src/lib/frontend/city-routes.ts payload-office-platform/tests/opt036-building-search.test.ts payload-office-platform/tests/public-catalog-facade.test.ts payload-office-platform/tests/city-routes.test.ts && git commit -m "feat(catalog): 楼盘搜索加 business=sale 出售口径：按 sale 聚合、只列有在售房源的楼盘（OPT-096）"
```

---

### Task 8: 楼盘列表页出售口径的文案 / 卡片量词 / metadata

**Files:**
- Modify: `src/components/frontend/city/CityBuildingsView.tsx:80-101`（`COPY` / `SORTS`）、`132`（heading）、`167-187`（switchRow）、`268-278`（副标题）、`348-352`（分组标题）、`378-`（卡片 props）
- Modify: `src/components/frontend/listing/BuildingResultCard.tsx:58-66`、`108-109`；`src/components/frontend/listing/BuildingResultRow.tsx:79-81`、`129`
- Modify: `src/app/(frontend)/[city]/buildings/page.tsx:55-60`（metadata）
- Test: `tests/opt036-buildings-view-wiring.test.ts`（追加）

**Interfaces:**
- Consumes: Task 7 的 `input.business`、`BuildingFilteredResult`。
- Produces: `BuildingResultCard` / `BuildingResultRow` 新 prop `stockUnitLabel?: string`（默认 `'套在租'`）；视图内 `SCOPE_COPY[scope]`；出售口径页 `<title>` 「{城市}在售写字楼楼盘」+ `robots: { index: false, follow: true }`。

- [ ] **Step 1: 写失败测试**

`tests/opt036-buildings-view-wiring.test.ts` 追加（照该文件现有渲染 `CityBuildingsView` 的方式与夹具，`result` 用有一个 withStock 楼盘的形状）：

```ts
  it('OPT-096：出售口径下量词、分组标题、排序项换成「在售」，不渲染「仅看有在租」开关', () => {
    const html = renderView({ input: { ...baseInput, business: 'sale' }, result: withOneStockBuilding })
    expect(html).toContain('套在售')
    expect(html).not.toContain('套在租')
    expect(html).toContain('在售最多')
    expect(html).not.toContain('仅看有在租')
    expect(html).toContain('写字楼出售')
  })

  it('OPT-096：租赁口径原样', () => {
    const html = renderView({ input: baseInput, result: withOneStockBuilding })
    expect(html).toContain('套在租')
    expect(html).toContain('仅看有在租')
    expect(html).not.toContain('套在售')
  })
```
`renderView` / `baseInput` / `withOneStockBuilding` 以该文件既有 helper 为准，没有就照它现有 it 块里的构造方式抽一个。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt036-buildings-view-wiring.test.ts -t "OPT-096"
```
Expected: 第一条 FAIL。

- [ ] **Step 3: 卡片量词 prop**

`BuildingResultCard.tsx` props 加 `stockUnitLabel?: string`，解构默认 `stockUnitLabel = '套在租'`；`ariaLabel` 改为 `` hasCount ? `${name}，${listingCount} ${stockUnitLabel}` : name ``；`<span className="bd-card__stock-unit">套在租</span>` 改为 `{stockUnitLabel}`。`BuildingResultRow.tsx` 同样三处（`bd-rowcard__stock-unit`）。

- [ ] **Step 4: 视图 scope**

`CityBuildingsView.tsx`：
- 在 `COPY` 之后加：
  ```ts
  /** 在租 / 在售两套口径的文案（OPT-096）。`business=sale` 时整页换成在售语境。 */
  const SCOPE_COPY = {
    lease: {
      headingSuffix: '写字楼',
      legacyHeading: '找写字楼',
      stockUnit: '套在租',
      stockNoun: '在租房源',
      groupTitle: '当前有在租',
      sorts: [
        { value: 'stock-desc', label: '在租最多' },
        { value: 'area-desc', label: '在租面积' },
      ],
    },
    sale: {
      headingSuffix: '写字楼出售',
      legacyHeading: '找出售写字楼',
      stockUnit: '套在售',
      stockNoun: '在售房源',
      groupTitle: '当前有在售',
      sorts: [
        { value: 'stock-desc', label: '在售最多' },
        { value: 'area-desc', label: '在售面积' },
      ],
    },
  } as const
  ```
  `SORTS` 常量改成函数或在组件内拼：`const sorts: readonly ResultToolbarSort[] = [...SCOPE_COPY[scope].sorts, <原来的等级 / 竣工两项>]`（把原 `SORTS` 数组里前两项删掉，剩余两项保留为 `TAIL_SORTS`）。
- 组件内开头：`const scope = input.business === 'sale' ? 'sale' : 'lease'` 与 `const scopeCopy = SCOPE_COPY[scope]`；
- `heading`：`routeMode === 'legacy' ? scopeCopy.legacyHeading : `${city.name}${scopeCopy.headingSuffix}``；
- 副标题「个现在有在租房源」→ `` 个现在有{scopeCopy.stockNoun} ``；
- 分组标题 `当前有在租` → `{scopeCopy.groupTitle}`；
- 两处 `switchRow={switchRow}` → `switchRow={scope === 'lease' ? switchRow : undefined}`；`rowActiveKeys.add(switchRow.paramKey)` 那行加 `scope === 'lease' &&` 前置条件；
- `<BuildingResultCard …>` 与 `<BuildingResultRow …>` 都加 `stockUnitLabel={scopeCopy.stockUnit}`；
- `ResultToolbar` 的 `sorts={SORTS}` → `sorts={sorts}`。

- [ ] **Step 5: metadata**

`[city]/buildings/page.tsx` `generateMetadata` 末尾改为：

```ts
  const base = buildCityPageMetadata({
    city,
    pageType: 'buildings',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
  // OPT-096：出售口径不进索引（与 /sale 频道同一取舍：起步期数量少，别拖站点评分），
  // 标题换成在售语境。canonical 仍带 business=sale，不与租赁口径合并。
  if (input.business !== 'sale') return base
  return { ...base, title: `${city.name}在售写字楼楼盘 · 商办买卖`, robots: { index: false, follow: true } }
```

- [ ] **Step 6: 跑测试**

```bash
cd /e/wt-096/payload-office-platform && pnpm vitest run tests/opt036-buildings-view-wiring.test.ts tests/opt036-building-search-result.test.ts tests/city-route-pages.test.ts && pnpm typecheck
```
Expected: 全 passed；typecheck 无输出。

- [ ] **Step 7: 提交**

```bash
cd /e/wt-096 && git add payload-office-platform/src/components/frontend/city/CityBuildingsView.tsx payload-office-platform/src/components/frontend/listing/BuildingResultCard.tsx payload-office-platform/src/components/frontend/listing/BuildingResultRow.tsx "payload-office-platform/src/app/(frontend)/[city]/buildings/page.tsx" payload-office-platform/tests/opt036-buildings-view-wiring.test.ts && git commit -m "feat(buildings): 楼盘列表出售口径的在售文案、卡片量词与 noindex（OPT-096）"
```

---

### Task 9: 闸门 + 后台 / C 端浏览器走查 + 证据 + 推送

**Files:**
- Create: `artifacts/verification/OPT-096/walkthrough-2026-09-12.md` + 截图
- Modify: `specs/work-items/OPT-096-building-form-and-nav-submenu.md`（状态、§4 勾选）
- Modify: `.claude/launch.json`（主仓 `E:\github\sbh\.claude\launch.json` 加 `wt-096` 项，端口 3728；该文件不入库）

- [ ] **Step 1: 全量静态闸门**

```bash
cd /e/wt-096/payload-office-platform && pnpm generate:types && pnpm typecheck && pnpm lint 2>&1 | tail -3 && pnpm migrate:dry-run 2>&1 | tail -4 && pnpm test:changed 2>&1 | tail -6
```
Expected: typecheck 无输出；lint 0 error（warning 基线 35，不增加）；dry-run 本迁移 `up/down/json` 齐全、无禁用模式；`test:changed` 全 passed。

- [ ] **Step 2: E2E 自查**

```bash
cd /e/wt-096/payload-office-platform && rg -n "site-nav__link|mobile-drawer__link|套在租|仅看有在租|ls-filterc__row|bd-group__title" tests/e2e/ | head -30
```
按命中逐条判断是否被本次结构 / 文案改动打破（租赁口径文案未变，只有出售口径与新增 DOM）；有计数类断言随 Task 6 Step 7 的说明调整。

- [ ] **Step 3: 起 dev server**

`launch.json` 加 `{ "name": "wt-096", "runtimeExecutable": "pnpm", "runtimeArgs": ["--dir", "E:/wt-096/payload-office-platform", "exec", "next", "dev", "-p", "3728"], "port": 3728 }`，`preview_start { name: "wt-096" }`。

- [ ] **Step 4: 后台走查（Payload 后台，夹具账号）**

先 `GET /admin/logout`（清掉别的端口串过来的 cookie，见记忆 [[localhost-cookies-ignore-port]]），再用页内 `fetch('/api/users/login', { method:'POST', body: JSON.stringify({ email:'e2e-adm@example.com', password:<scripts/seed.ts 里的夹具密码> }) })` 登录。

| # | 操作 | 判据 |
|---|---|---|
| 1 | `/admin/collections/listings/<任一 id>` | 基本信息区出现「建筑形态」多选控件（Arco/react-select 多选） |
| 2 | 勾选「独栋」「联排」→ 保存 | 200；`GET /api/listings/<id>?depth=0` 回读 `buildingForm: ['detached','townhouse']`（顺序为勾选顺序） |
| 3 | 清空 → 保存 | 200；回读 `buildingForm: []` 或 `null` |
| 4 | `/admin/globals/site-settings` → 详情页参数 → 房源 → 面积与格局 | 出现「建筑形态」checkbox，默认勾选 |

Arco 多选用 JS click 触发不了（记忆 [[payload-arco-custom-field-traps]]）——用真实坐标点击；若拿不到坐标就改用 Playwright 脚本（`page.getByLabel('建筑形态')` + `selectOption` / 点击）完成 2–3，截图存证。

- [ ] **Step 5: C 端走查（Playwright 脚本出图 + DOM 判据，样例见 `artifacts/verification/OPT-095/`）**

| # | 路由 / 视口 | 判据 |
|---|---|---|
| 1 | `/shanghai/listings/<第 4 步那套房源 slug>` 1440 | 「房源概况」参数表出现「建筑形态：独栋、联排」 |
| 2 | 站点设置关掉「建筑形态」后同页 | 该行消失（站点设置 afterChange 失效缓存；不出现就 `revalidate` 或重启 dev） |
| 3 | `/shanghai/listings?form=detached` | 只出带独栋的房源；筛选行「建筑形态」pill 高亮「独栋」；`/shanghai/listings` 筛选行出现「建筑形态」且计数 = 带该形态的有效房源数 |
| 4 | `/shanghai` 1440，hover「找办公室」 | `.site-nav__menu` 可见（`getComputedStyle().visibility === 'visible'`），两个子项 `href` 为 `/shanghai/listings`、`/shanghai/sale`；Tab 到父项后 `:focus-within` 同样展开 |
| 5 | `/shanghai/sale` 1440 | 「找办公室」父项 `aria-current="page"`，子项「出售」高亮、「租赁」不高亮 |
| 6 | `/shanghai/buildings?business=sale` 1440 | 只列有在售房源的楼盘（对照 `psql` 在 `sbh_dev_096` 上 `select count(distinct building_id) from listings where business_type='sale' and publication_status='published' and review_status='approved'` 的量级）；卡片「N 套在售」；无「仅看有在租」开关；`<title>` 含「在售写字楼」；`<meta name="robots">` 为 noindex |
| 7 | `/shanghai/buildings` 1440 | 与改动前一致：「套在租」「仅看有在租」都在，`.site-nav__group` 里「找楼盘」父项与「租赁」子项高亮 |
| 8 | `/shanghai` 375 抽屉 | 「找办公室」下缩进两行「租赁 / 出售」，「找楼盘」下同；点子项能关抽屉并跳转 |

夹具库若没有出售房源，用后台把一套房源 `businessType` 改成 `sale` 并审核通过上架后再验 6（记录在证据里，别忘了这是任务库不是共享库）。

- [ ] **Step 6: 证据 + 状态 + 提交 + 推送**

写 `artifacts/verification/OPT-096/walkthrough-2026-09-12.md`（环境行 + 后台表 + C 端表 + 闸门行）；规格状态改「**已实施，待合并**」、§4 勾选实际完成项。

```bash
cd /e/wt-096 && git add artifacts/verification/OPT-096/ specs/work-items/OPT-096-building-form-and-nav-submenu.md specs/work-items/OPT-096-plan.md && git commit -m "docs(opt-096): 实施计划、走查证据与工作项状态" && git push -u origin feat/opt-096-building-form-nav-submenu-2db1
```

推送后向用户汇报走查结果与证据路径，由用户决定合并（合并即上线，且**本次带迁移**——生产 `migrate` 由 deploy 链路执行，合并前确认 `DEPLOYMENT.md` 里迁移步骤未变）。

---

## 自审记录

- **规格覆盖**：§3.1 → Task 1 + 2；§3.2 → Task 3 + 4；§3.3 → Task 1（登记项 + 迁移列）+ Task 2（resolver）；§3.4 → Task 5 + 6；§3.5 → Task 7 + 8；§4 验收 → Task 9。规格 §3.5 提到「sitemap 不进」——楼盘列表 sitemap 只出无参 `/buildings`（`getCachedSitemapBuildingsPageByCity` 走 `searchBuildingsPage`，不带 input），`?business=sale` 天然不进；Task 8 只做 noindex。
- **占位扫描**：无 TBD；「执行时核对」类句子都给了具体 `rg` 命令与替代写法。
- **类型一致性**：`attachMainNavSubmenu` 泛型返回带可选 `children`，`PublicNavItem.children?: readonly NavSubItem[]` 与之一致；`searchBuildings` 第三参 `'lease' | 'sale'` 与 `input.business ?? 'lease'` 一致；`buildingFormCounts` 在 Task 4 的测试与实现里同名；`ListingSpecContext` 在 Task 2 测试字面量里带 `buildingForm: []` 与 Pick 一致。
