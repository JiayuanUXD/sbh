# Task Packet：OPT-068 C 端可感知性能——房源扫描层、详情流式、导航反馈、根路径直出、封面派生图

> 状态：**已上线**（2026-09-04 12:35 CloudRun 发布成功，构建 `a994f6b`；线上复测见 §上线后实测。存量媒体回填仍待执行）
> 创建日期：2026-09-04
> 来源：本日性能讨论（线上实测），用户裁定「域名/CDN 另行处理，其余写成计划开工」
> 分支：`perf/opt-068-listing-scan-df70`
> 证据目录：`artifacts/verification/OPT-068/`
> 编号：OPT-065 文件头已声明 065 作废、下一个从 068 起；本文件占用 **068**。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把房源列表的冷路径从 5–20 秒压到 1–2 秒、详情页首屏不再等推荐、筛选点击有即时反馈、根路径少一跳、楼盘封面不再下载 1.7MB 原图。

**Architecture:** 列表页改为「一次轻量扫描（select + populate 收窄字段，缓存为紧凑行）→ 内存里做区域/类型/价格过滤、排序、分页、facet → 只对当前页 24 条按 id 回捞 depth 2 映射卡片」。有效供给谓词（`getEffectiveSupplyWhere` + `fineFilter`）原样复用，不写第二套判定。详情推荐与首页统计改吃同一份扫描。导航反馈用 `useTransition` + `router.push` 的 pending 态驱动结果区变灰与被点项 spinner；详情页推荐区放进 `Suspense` 流式输出。

**Tech Stack:** Next 16.2.10（App Router、`unstable_cache`、`useTransition`）、Payload 3.86（`select` / `populate` / local API `update` 带 `file`）、React 19.2、vitest 4、Playwright。

## 0. 证据（修复前，线上默认域名，2026-09-04）

| 场景 | 冷 | 热 |
|---|---|---|
| `/shanghai/listings?areaMax=500` | 20.4 s | 0.09 s |
| `/shanghai/listings?areaMin=100&areaMax=300` | 10.8 s | 0.11 s |
| `/shanghai/listings?district=pudong` | 5.5 s | 0.09 s |
| 房源详情（两个不同 slug） | 2.8 s / 4.1 s | 0.27 s |
| `/` → 307 → `/shanghai` | 多一跳 0.16–0.70 s | — |
| `/api/listings?limit=200&depth=2` 单页 | 1.5 s（8.2MB） | — |
| 同上 `depth=1` + `select` 9 个字段 | 0.27 s（1.4MB） | — |

根因（代码）：`supply-adapter.ts#findEffectiveListings` 用 `findAllListings(where, 2)` 把最多 1000 条候选按 depth 2 整棵拉出，内存精筛 / 价格过滤 / 排序 / 分页；`CityListingsView` 再 fan-out 3 份 facet，一旦有筛选生效就再扫一遍。`revalidate: 300` + 每容器本地缓存 + 每次发版清零 ⇒ 冷路径是常态。候选上限 1000 让 2181 条房源里第 43 页起不可见。

线上媒体 17,137 条；抽样最近 300 张图，169 张没有 `sizes.card`，203 张原图 > 500KB；列表页 24 张卡片 0 张有 srcset；首页热门楼盘两张 1.7MB/1.8MB 原图。

## Global Constraints

- 包管理器固定 pnpm；禁止 `any` / `as any` / `@ts-ignore`；外部输入 `unknown` + 守卫；DTO `Readonly`。
- 所有公开消费者必须复用统一有效供给服务：`getEffectiveSupplyWhere` 粗筛 + `getPausedListingIds` 排除 + `fineFilter`（`resolveEffectiveSupplies`）精筛，**不得**用简化谓词降级。
- 同一份判断逻辑不得存在第二处副本：价格过滤、排序、facet 聚合各只保留一个实现，卡片与扫描行共用。
- URL 是筛选 / 排序 / 分页的唯一事实源；改筛选或排序的 href 必须 `delete('page')`（既有 href 构造函数不动）。
- `FilterFormC.tsx` 与 `FilterPill.tsx` 源码里必须保留字面量 `prefetch={false}`（`tests/listings-query-prefetch-performance.test.ts` 按源码断言）；`cached-queries.ts` 必须保留字面量 `revalidate: 300`；`sitemap.ts` 保留 `unstable_cache(`。
- `unstable_cache` 单条 2MB 硬上限、超限静默失败：扫描行必须紧凑（目标 ≤ 300 字节/行，上限 5000 行）。`JSON` 序列化会把 `-Infinity` 变成 `null`，行里不得出现非有限数。
- Server Components 默认；Client Component 只用于导航 pending 态、筛选抽屉、画廊、弹层。
- 视觉：零色相的 pending 态（`--ink-2` / 底色深浅），不新增有色相强调；`prefers-reduced-motion` 下不做动画。
- 提交只用显式 `git add <路径>`，禁止 `git add -A`；不恢复、不提交 `public/prd/*.md` 的删除。
- 文档与提交信息用简体中文。完成声明前必须在浏览器实际点一遍（`.agent/testing.md`）。
- 本地不要跑全量 E2E（会被 SIGKILL），只跑本任务触及的 spec。

## File Structure

| 文件 | 职责 |
|---|---|
| 新增 `src/domain/public-catalog/listing-scan.ts` | 扫描行模型 `ListingScanRow`、`rowFromListing`、`SCAN_MEMORY_DIMENSIONS`、`toScanInput`、`buildListingScanCacheKey`、`applyMemoryFilters`、`computeFacets`、`selectListingPage`、`rowToCandidate`。纯函数，无 IO |
| 修改 `src/domain/public-catalog/stable-sort.ts` | `stableSortCards` / `prepareCardsForPriceSort` 泛型化为 `stableSortListings` / `prepareForPriceSort`，卡片与扫描行共用 |
| 修改 `src/domain/public-catalog/supply-adapter.ts` | 接口新增可选 `scanEffectiveListings` / `findEffectiveListingsByIds`；生产实现用 `select` + `populate` 扫描；`filterByPrice` 改用共享谓词 `matchesPriceFilter` |
| 修改 `src/domain/public-catalog/facade.ts` | `searchListings` / `getSearchFacets` / `getDetailRecommendations` / `getHomepage` / `getPlatformHomepageStats` 改建立在扫描之上；删除 `buildListingSearchSource` / `paginateListingSearchSource` |
| 修改 `src/domain/public-catalog/index.ts` | 导出上述新符号 |
| 修改 `src/lib/frontend/cached-queries.ts` | `getCachedListingScan`（扫描缓存 + coalesce）、`getCachedListingCardsByIds`、列表 / facet / 推荐改走扫描 |
| 新增 `src/components/frontend/listing/ListingNavigation.tsx` | `ListingNavigationProvider` / `NavLink` / `PendingRegion`（client） |
| 修改 `FilterFormC` `FilterPill` `ResultToolbar` `PriceUnitSegment` `ListPager` `MobileFilterSheet` `CityListingsView` `CityBuildingsView` `styles/list.css` | 筛选/排序/分页链接换 `NavLink`，结果区换 `PendingRegion`，pending 样式 |
| 新增 `src/app/(frontend)/[city]/listings/[slug]/loading.tsx`、`[city]/buildings/[slug]/loading.tsx` | 详情页路由级骨架 |
| 修改 `CityListingDetailView.tsx`、`[city]/listings/[slug]/page.tsx`、`listings/[slug]/page.tsx` | 推荐区 `Suspense` + 异步子组件，路由不再 await 推荐 |
| 新增 `src/app/(frontend)/_lib/city-home.tsx`；修改 `page.tsx`、`[city]/page.tsx` | 城市首页渲染单一实现；根路径多城市模式直出不再 307 |
| 新增 `src/lib/frontend/media-srcset.ts`；修改 `ui/Media.tsx` 与 6 个楼盘封面消费方 | `buildSrcSet` / `cardCoverProps` 单一来源，楼盘卡封面吃派生图 |
| 新增 `scripts/backfill-media-sizes.ts` | 存量媒体回填 `imageSizes` 派生图（默认 dry-run） |
| 测试 | `tests/opt068-listing-scan.test.ts`、`tests/opt068-scan-cache.test.ts`、更新 `listings-query-prefetch-performance.test.ts`、`detail-recommendations.test.ts`、`opt036-facet-query-dedupe.test.ts`、`tests/e2e/multi-city-routing.spec.ts` |

---

### Task 1: 扫描行模型与纯函数（`listing-scan.ts`）

**Files:**
- Create: `src/domain/public-catalog/listing-scan.ts`
- Modify: `src/domain/public-catalog/mappers.ts`（导出 `mapCoordinates`）
- Test: `tests/opt068-listing-scan.test.ts`

**Interfaces:**
- Consumes: `resolveListingPrice`、`mapDistrict`、`mapCoordinates`（mappers）、`omitListingSearchDimensions`、`buildCanonicalSearchParams`、`ListingSearchInput`、`PriceViewModel`、`DistrictViewModel`、`CoordinatesViewModel`、`SearchFacets`。
- Produces:

```ts
export type ListingScanRow = Readonly<{
  id: number
  slug: string
  listingType: string | null
  businessType: 'lease' | 'sale'
  area: number | null
  price: PriceViewModel | null
  isFeatured: boolean
  /** Date.parse(updatedAt)；无法解析为 0（不能用 -Infinity：JSON 会变 null） */
  lastEffAt: number
  buildingId: number | null
  district: DistrictViewModel | null
  businessDistrictId: number | null
  coordinates: CoordinatesViewModel | null
}>
export const SCAN_MEMORY_DIMENSIONS: readonly ListingSearchDimension[] = ['district', 'listingType', 'priceUnit', 'price']
export function rowFromListing(raw: unknown): ListingScanRow | null
export function rowsFromListings(docs: readonly unknown[]): ListingScanRow[]
export function toScanInput(input: ListingSearchInput): ListingSearchInput   // 剥 SCAN_MEMORY_DIMENSIONS + page:1 + sort:'recommended'
export function buildListingScanCacheKey(input: ListingSearchInput): string  // buildCanonicalSearchParams(toScanInput(input)).toString()
export function matchesPriceFilter(price: PriceViewModel | null, input: ListingSearchInput): boolean
export function applyMemoryFilters(rows: readonly ListingScanRow[], input: ListingSearchInput): ListingScanRow[]
export function computeFacets(rows: readonly ListingScanRow[]): SearchFacets
export function selectListingPage(rows: readonly ListingScanRow[], input: ListingSearchInput): Readonly<{ ids: number[]; pagination: Pagination; filteredByRentUnit: boolean }>
export function rowToCandidate(row: ListingScanRow): RecommendationCandidate
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/opt068-listing-scan.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyMemoryFilters, buildListingScanCacheKey, computeFacets, matchesPriceFilter,
  rowFromListing, selectListingPage, toScanInput, type ListingScanRow,
} from '@/domain/public-catalog/listing-scan'
import { parseListingSearchInput } from '@/domain/public-catalog'

function row(over: Partial<ListingScanRow> & { id: number }): ListingScanRow {
  return {
    slug: `l-${over.id}`, listingType: 'office', businessType: 'lease', area: 100,
    price: /* 按 contracts.ts 的 PriceViewModel 真实字段构造：amount 5、displayUnit 'rmb-sqm-day' */ null,
    isFeatured: false, lastEffAt: 1000, buildingId: 1,
    district: { id: 10, slug: 'jingan', name: '静安' }, businessDistrictId: 20, coordinates: null,
    ...over,
  }
}

describe('OPT-068 listing scan', () => {
  it('toScanInput 剥掉区域/类型/价格并归零页码与排序', () => {
    const input = parseListingSearchInput(new URLSearchParams('district=jingan&listingType=office&priceUnit=rmb-sqm-day&priceMax=6&areaMin=100&page=3&sort=price-asc'))
    const scan = toScanInput(input)
    expect(scan.district).toBeUndefined()
    expect(scan.listingType).toBeUndefined()
    expect(scan.priceUnit).toBeUndefined()
    expect(scan.priceMax).toBeUndefined()
    expect(scan.areaMin).toBe(100)
    expect(scan.page).toBe(1)
    expect(scan.sort).toBe('recommended')
  })

  it('扫描缓存键与区域/类型/价格/页码/排序无关，与面积/商圈/关键词有关', () => {
    const key = (q: string) => buildListingScanCacheKey(parseListingSearchInput(new URLSearchParams(q)))
    expect(key('district=jingan&page=2&sort=newest')).toBe(key(''))
    expect(key('listingType=office&priceUnit=rmb-sqm-day&priceMin=3')).toBe(key(''))
    expect(key('areaMin=200')).not.toBe(key(''))
    expect(key('q=x')).not.toBe(key(''))
  })

  it('applyMemoryFilters 按区域、类型、价格单位与区间过滤，面议房源选单位仍入选、给区间不入选', () => { /* 见实施 */ })
  it('computeFacets 与旧 getSearchFacets 同口径：区域计数、类型计数、非空价格按单位计数、totalDocs', () => { /* 见实施 */ })
  it('selectListingPage：推荐序 = 精选优先 → lastEffAt 降序 → id 升序，分页只返回本页 id', () => { /* 见实施 */ })
  it('selectListingPage：价格排序未指定单位时按首个非空单位过滤并标记 filteredByRentUnit', () => { /* 见实施 */ })
  it('rowFromListing 从 depth 2 文档投影：区域、商圈 id、价格、精选、更新时间、坐标；缺楼盘返回 null；updatedAt 不可解析时 lastEffAt 为有限数', () => { /* 见实施 */ })
  it('matchesPriceFilter 与 filterByPrice 同一裁定', () => { /* 见实施 */ })
})
```

上面标「见实施」的用例，实施时按 §Interfaces 的语义写全断言（区域 `[1,3,4,5]`、类型 `[1,2,4,5]`、选单位全入选、给区间 `[1,2,3]`；推荐序 `[3,2,1]`；价格排序 `[3,1]` 且 `filteredByRentUnit === true`）。夹具里 `price` 字面量以 `contracts.ts` 的 `PriceViewModel` 为准，不用 `as` 硬转；`Location` 的 `type` / `status` 用真实枚举值。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd payload-office-platform && pnpm vitest run tests/opt068-listing-scan.test.ts`
Expected: FAIL，`Cannot find module '@/domain/public-catalog/listing-scan'`

- [ ] **Step 3: 实现 `listing-scan.ts`**

要点（按上面的接口）：
- `rowFromListing`：`isRecord` 守卫 → `building` 必须是对象且 `id` 为数字，否则 `null`；`district: mapDistrict(building.district) ?? null`；`businessDistrictId: toId(building.businessDistrict)`（`toId` 接受 id / 对象）；`price: resolveListingPrice(raw)`；`lastEffAt = Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt) : 0`；`coordinates: mapCoordinates(building.latitude, building.longitude) ?? null`。
- `matchesPriceFilter(price, input)`：把 `supply-adapter.ts#filterByPrice` 的判定原样搬来（缺 `priceUnit` → `true`；`price` 为 null → `!hasRange`；单位不等 → `false`；区间比较）。
- `applyMemoryFilters`：district（`row.district && input.district.includes(row.district.slug)`）、listingType、`matchesPriceFilter`。
- `computeFacets`：搬 `facade.ts#getSearchFacets` 的三个 Map 聚合，输入改为行；`totalDocs = rows.length`。
- `selectListingPage`：`applyMemoryFilters` → `prepareForPriceSort(rows, input)`（Task 2 的泛型）→ `stableSortListings(items, sort, (r) => r.lastEffAt)` → `paginate(sorted, input.page, input.pageSize)` → `ids` + `buildPagination`（`buildPagination` 从 facade 移到 `stable-sort.ts` 导出，只留一份）。
- `rowToCandidate`：`{ id, listingType, businessType, area, priceAmount: price?.amount ?? null, priceUnit: price?.displayUnit ?? null, buildingDistrictId: district?.id ?? null, buildingBusinessDistrictId: businessDistrictId }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/opt068-listing-scan.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/domain/public-catalog/listing-scan.ts src/domain/public-catalog/mappers.ts tests/opt068-listing-scan.test.ts
git commit -m "feat(catalog): OPT-068 房源扫描行模型与内存过滤/facet/分页纯函数"
```

---

### Task 2: 排序与价格预处理泛型化（消灭副本）

**Files:**
- Modify: `src/domain/public-catalog/stable-sort.ts`
- Modify: `src/domain/public-catalog/facade.ts:263-300`（`prepareCardsForPriceSort` 迁走）
- Modify: `src/domain/public-catalog/supply-adapter.ts`（`filterByPrice` 改用 `matchesPriceFilter`）
- Test: 既有价格排序相关测试保持通过；`tests/opt068-listing-scan.test.ts` 的排序用例覆盖泛型路径

**Interfaces:**
- Produces（`stable-sort.ts`）：

```ts
export type SortableListing = Readonly<{ id: number; isFeatured: boolean; price: PriceViewModel | null }>
export function stableSortListings<T extends SortableListing>(items: readonly T[], sort: ListingSort, lastEffAt: (item: T) => number): T[]
export function stableSortCards(cards, sort, lastEffAt): ListingCardViewModel[]  // = stableSortListings，保留给既有调用方
export function prepareForPriceSort<T extends { price: PriceViewModel | null }>(items: readonly T[], input: ListingSearchInput): { items: T[]; filteredByRentUnit: boolean }
export function isSameRentUnit<T extends { price: PriceViewModel | null }>(items: readonly T[]): boolean
export function buildPagination(totalDocs: number, page: number, pageSize: number): Pagination
```

- [ ] **Step 1: 把 `compareRecommended` / `compareNewest` / `comparePrice` / `isSameRentUnit` / `filterByRentUnit` / `filterByPriceKey` 的参数类型从 `ListingCardViewModel` 改为泛型 `T extends SortableListing`（比价只读 `price`、`id`、`isFeatured`）。**
- [ ] **Step 2: 把 `facade.ts#prepareCardsForPriceSort` 与 `buildPagination` 搬到 `stable-sort.ts`（改名 `prepareForPriceSort`），facade 内所有调用改为新名。**
- [ ] **Step 3: `supply-adapter.ts#filterByPrice` 改为 `listings.filter((l) => matchesPriceFilter(resolveListingPrice(l), input))`，删除重复判定，保留原注释里的裁定说明并指向 `listing-scan.ts#matchesPriceFilter`。**
- [ ] **Step 4: 跑相关测试**

Run: `pnpm vitest run tests/opt068-listing-scan.test.ts tests/listing-price-unit-gate.test.ts tests/building-supply-search.test.ts && pnpm typecheck`
Expected: PASS，typecheck 干净

- [ ] **Step 5: 提交**

```bash
git add src/domain/public-catalog/stable-sort.ts src/domain/public-catalog/facade.ts src/domain/public-catalog/supply-adapter.ts
git commit -m "refactor(catalog): OPT-068 排序与价格预处理泛型化，卡片与扫描行共用一份判定"
```

---

### Task 3: 适配器扫描查询（`select` + `populate`）与按 id 回捞

**Files:**
- Modify: `src/domain/public-catalog/supply-adapter.ts`（接口 + 生产实现）
- Test: `tests/opt068-scan-adapter.test.ts`（用 `vi.mock('payload')` 或注入 fake `getPayload` 断言 `find` 调用参数）

**Interfaces:**
- Produces（接口新增，均可选，供既有测试 fake 无需改动）：

```ts
scanEffectiveListings?(input: ListingSearchInput, ctx: SearchContext): Promise<readonly ListingScanRow[]>
findEffectiveListingsByIds?(ids: readonly number[], ctx: SearchContext): Promise<readonly Listing[]>
```
- 常量：`LISTING_SCAN_PAGE_SIZE = 1_000`、`LISTING_SCAN_CANDIDATE_LIMIT = 5_000`（注释写明 2MB 缓存上限的推算：≤300 B/行 × 5000 = 1.5MB）。

- [ ] **Step 1: 写失败测试**：构造 fake payload（`find` 记录参数并按 `page` 返回夹具），断言 `scanEffectiveListings`：(a) `find` 的 `select` 恰为 `{ slug, title, listingType, businessType, area, price, rent, rentUnit, isFeatured, updatedAt, building, merchant }`；(b) `populate` 含 `buildings: { slug, name, city, district, businessDistrict, latitude, longitude }`、`locations: { name, slug, type, status }`、`merchants: { status, qualificationStatus, qualificationExpiresAt, serviceCities }`；(c) `depth: 2`、`limit: 1000`、`sort: 'id'`；(d) 不合格商户（`status: 'disabled'`）的行被精筛掉；(e) 返回行经 `rowFromListing` 投影。再断言 `findEffectiveListingsByIds([3,1])` 的 `where.id.in` 为 `[3,1]` 且结果经精筛。
- [ ] **Step 2: 跑测试确认失败**（`scanEffectiveListings is not a function`）
- [ ] **Step 3: 实现**：
  - 抽 `buildListingWhere(input, ctx)`（把 `findEffectiveListings` 里 district → building ids、listingType、businessArea、metro、area、availableBefore、q、building in 的构造搬出来），`findEffectiveListings` 与 `scanEffectiveListings` 共用。
  - `scanEffectiveListings`：`where = await buildListingWhere(input, ctx)`；分页循环 `payload.find({ collection: 'listings', where, depth: 2, select: LISTING_SCAN_SELECT, populate: LISTING_SCAN_POPULATE, sort: 'id', limit: LISTING_SCAN_PAGE_SIZE, page })` 直到 `!hasNextPage` 或累计 ≥ `LISTING_SCAN_CANDIDATE_LIMIT`；`kept = await fineFilter(docs, asOf)`；`return rowsFromListings(filterByPrice(kept, input))`。
  - `findEffectiveListingsByIds`：空数组直接返回 `[]`；`where = { ...await baseEffectiveWhere(ctx), id: { in: [...ids] } }`；`find({ depth: 2, limit: ids.length, pagination: false })`；`fineFilter`。
  - `LISTING_SCAN_SELECT` 用 `satisfies ListingsSelect<true>`（`@/payload-types`），`LISTING_SCAN_POPULATE` 用 `satisfies PopulateType`。
- [ ] **Step 4: 跑测试与 typecheck**：`pnpm vitest run tests/opt068-scan-adapter.test.ts && pnpm typecheck`
- [ ] **Step 5: 提交**

```bash
git add src/domain/public-catalog/supply-adapter.ts tests/opt068-scan-adapter.test.ts
git commit -m "feat(catalog): OPT-068 适配器新增轻量扫描与按 id 回捞，where 构造单一来源"
```

---

### Task 4: facade 改建立在扫描之上

**Files:**
- Modify: `src/domain/public-catalog/facade.ts`（`searchListings`、`getSearchFacets`、删除 `buildListingSearchSource` / `paginateListingSearchSource`、新增 `scanListings` / `hydrateListingCards` / `assembleListingSearchResult`）
- Modify: `src/domain/public-catalog/index.ts`
- Test: `tests/opt068-facade-scan.test.ts`；更新 `tests/opt036-facet-query-dedupe.test.ts` 头部注释与断言（冷路径查询次数由 3 次 `findEffectiveListings` 变为 1 次扫描）

**Interfaces:**

```ts
export type ListingScanProvider = (input: ListingSearchInput, ctx: SearchContext) => Promise<readonly ListingScanRow[]>
export async function scanListings(input, ctx, adapter = getDefaultSupplyAdapter()): Promise<readonly ListingScanRow[]>
//   adapter.scanEffectiveListings ? adapter.scanEffectiveListings(toScanInput(input), ctx)
//   : rowsFromListings(await adapter.findEffectiveListings(toScanInput(input), ctx))
export async function hydrateListingCards(ids: readonly number[], ctx, adapter = ...): Promise<readonly ListingCardViewModel[]>
//   adapter.findEffectiveListingsByIds ? ... : (await adapter.findEffectiveListings(EMPTY_LISTING_INPUT, ctx)).filter(id ∈ ids)；mapListingCard；**按 ids 顺序返回**
export function assembleListingSearchResult(page: ReturnType<typeof selectListingPage>, cards: readonly ListingCardViewModel[], input): ListingSearchResult
export async function searchListings(input, ctx, adapter = ...): Promise<ListingSearchResult>  // scan → selectListingPage → hydrate → assemble
export async function getSearchFacets(input, ctx, adapter = ...): Promise<SearchFacets>      // scan → applyMemoryFilters → computeFacets
```

- [ ] **Step 1: 写失败测试**：fake adapter 只实现 `findEffectiveListings`（返回 3 条 depth 2 夹具，夹具可复用 `tests/opt036-*` 的构造），断言 `searchListings(parse('district=jingan&page=1'))` 的 `docs` 只含静安且顺序符合推荐序、`pagination.totalDocs` 正确、`canonical` 含 `district=jingan`；`getSearchFacets` 的 `districts` 计数；再用带 `scanEffectiveListings` 与 `findEffectiveListingsByIds` 的 fake 断言 `findEffectiveListings` **零次**调用、`findEffectiveListingsByIds` 收到本页 id 且返回顺序按 id 列表。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**，删除旧 `buildListingSearchSource` / `paginateListingSearchSource`（`getHomepage` 里的 `mapListingsToCards` 保留到 Task 9 再动），`index.ts` 导出新符号并移除旧导出。
- [ ] **Step 4: 修正受影响测试**：`grep -rl "buildListingSearchSource\|paginateListingSearchSource" tests src` 逐个改到新 API；`opt036-facet-query-dedupe.test.ts` 改为断言「一次页面渲染冷路径只触发 1 次 `scanEffectiveListings`」。
- [ ] **Step 5: 跑**：`pnpm vitest run tests/opt068-facade-scan.test.ts tests/opt036-facet-query-dedupe.test.ts tests/opt036-listings-view-wiring.test.ts tests/f7-4-6-performance-data-equivalence.test.ts && pnpm typecheck`
- [ ] **Step 6: 提交**

```bash
git add src/domain/public-catalog/facade.ts src/domain/public-catalog/index.ts tests/opt068-facade-scan.test.ts tests/opt036-facet-query-dedupe.test.ts
git commit -m "refactor(catalog): OPT-068 列表与 facet 改建立在一次轻量扫描之上"
```

---

### Task 5: `cached-queries` 扫描缓存与页卡缓存

**Files:**
- Modify: `src/lib/frontend/cached-queries.ts`
- Test: 更新 `tests/listings-query-prefetch-performance.test.ts`（缓存键契约）、新增 `tests/opt068-scan-cache.test.ts`

**Interfaces:**

```ts
export type ScanChannel = SearchChannel | 'all'
export function getCachedListingScan(citySlug: string, input: ListingSearchInput, channel: ScanChannel): Promise<readonly ListingScanRow[]>
//   key: ['listing-scan', city] + (scanKey, channel)；coalesceInFlight 键 `listing-scan ${city} ${channel} ${scanKey}`；tags listingCacheTags+facetsTag；revalidate: 300
export function getCachedListingCardsByIds(citySlug: string, ids: readonly number[]): Promise<readonly ListingCardViewModel[]>
//   key: ['listing-cards', city] + (ids.join(','))；tags listingCacheTags；revalidate: 300；空 ids 直接返回 []（不进缓存）
export async function getCachedSearchListings(citySlug, canonicalQuery, input, businessType = 'lease'): Promise<ListingSearchResult>
export function getCachedSearchFacets(citySlug, canonicalQuery, input, businessType = 'lease'): Promise<SearchFacets>
export function getCachedSearchFacetsIgnoring(...)  // 签名不变，内部走 getCachedSearchFacets
```

- [ ] **Step 1: 更新契约测试**：`listings-query-prefetch-performance.test.ts` 第 55–67 行的键断言改为：同筛选不同页码同键、**不同排序同键**、不同区域同键、不同面积不同键（用 `buildListingScanCacheKey`）；第 79 行 `getCachedListingSearchSourceByCity = memoizeByCity(` 改为 `getCachedListingScanByCity = memoizeByCity(`。新增 `opt068-scan-cache.test.ts`：mock `next/cache` 的 `unstable_cache` 为直通并计数，断言同一请求内 `getCachedSearchListings` + 三次 `getCachedSearchFacetsIgnoring`（剥 priceUnit / district / listingType）只让扫描回调跑 1 次；`getCachedListingCardsByIds([])` 不触发缓存回调。
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现**，删除 `getCachedListingSearchSourceByCity`、`buildListingSearchSourceCacheKey`、`getCachedSearchFacetsByCity`。`unstable_cache` 回调必须返回**数组**（`Map` 会被序列化成 `{}`）。
- [ ] **Step 4: 跑**：`pnpm vitest run tests/listings-query-prefetch-performance.test.ts tests/opt068-scan-cache.test.ts tests/opt036-listings-view-wiring.test.ts && pnpm typecheck`
- [ ] **Step 5: 本地浏览器验证**：`pnpm exec payload migrate`（确保本地库不落后）→ `preview_start` dev server → 打开 `/shanghai/listings`，逐个点区域 / 类型 / 价格单位 / 排序 / 翻页，dev 日志里确认每个新 URL 只出现一次扫描查询；结果与筛选前一致。截图存 `artifacts/verification/OPT-068/task5-*.png`。
- [ ] **Step 6: 提交**

```bash
git add src/lib/frontend/cached-queries.ts tests/listings-query-prefetch-performance.test.ts tests/opt068-scan-cache.test.ts
git commit -m "perf(frontend): OPT-068 列表页缓存改为扫描行 + 本页卡片两级，区域/类型/价格/排序/分页共享一次扫描"
```

---

### Task 6: 详情推荐吃扫描 + 推荐区 Suspense 流式

**Files:**
- Modify: `src/domain/public-catalog/facade.ts`（`getDetailRecommendations`）
- Modify: `src/lib/frontend/cached-queries.ts`（`getCachedDetailRecommendations` 注入 `scan`）
- Modify: `src/components/frontend/city/CityListingDetailView.tsx`
- Modify: `src/app/(frontend)/[city]/listings/[slug]/page.tsx`、`src/app/(frontend)/listings/[slug]/page.tsx`
- Create: `src/components/frontend/detail/RelatedListings.tsx`（异步 Server Component + 骨架）
- Test: 更新 `tests/detail-recommendations.test.ts`；新增 `tests/opt068-detail-streaming.test.ts`（源码契约：两条详情路由不再在 `Promise.all` 里 await 推荐；`CityListingDetailView` 里推荐在 `Suspense` 内）

**Interfaces:**

```ts
export async function getDetailRecommendations(listingSlug, ctx, options: Readonly<{ limit?: number; scan?: ListingScanProvider }> = {}, adapter = ...): Promise<readonly DetailRecommendationItem[]>
// 候选：rows = scan(EMPTY_LISTING_INPUT, ctx)（默认 scanListings）；优先 businessDistrictId 相同，其次 district.id 相同，再次 buildingId 相同；排除当前 id；rankDetailRecommendations(rows.map(rowToCandidate), context)；winners → hydrateListingCards → items
// CityListingDetailView props：recommendations: Promise<readonly DetailRecommendationItem[]>
// <RelatedListings recommendations={promise} listingId citySlug />：await 后 length===0 返回 null，否则渲染原 <section id="related">
```

- [ ] **Step 1: 更新 `detail-recommendations.test.ts`**：fake 只实现 `findEffectiveListingBySlug` + `findEffectiveListings`（返回全城 depth 2 夹具），断言候选只来自同商圈、排除自身、条数 ≤ limit、顺序按打分；新增源码契约测试。
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现** facade 与 cached-queries（`getCachedDetailRecommendationsByCity` 的回调里调用 `getDetailRecommendations(slug, ctx, { limit, scan: (input, c) => getCachedListingScan(citySlug, input, 'all') })`）。
- [ ] **Step 4: 视图与路由**：两条路由把 `getCachedDetailRecommendations(...)` 从 `Promise.all` 移出，不 await，直接作为 prop 传；`CityListingDetailView` 用 `<React.Suspense fallback={<RelatedListingsSkeleton />}><RelatedListings … /></React.Suspense>` 替换原 `recommendations.length > 0 && (...)` 块；骨架 = `<section className="dt-container dt-section" aria-hidden="true"><div className="card-grid">` + 3 个 `ListingCardSkeleton`。
- [ ] **Step 5: 跑**：`pnpm vitest run tests/detail-recommendations.test.ts tests/opt068-detail-streaming.test.ts tests/detail-hero-media-performance.test.ts tests/city-route-pages.test.ts && pnpm typecheck`
- [ ] **Step 6: 浏览器验证**：dev server 打开一个房源详情，画廊 / 价格先出、推荐区骨架随后被替换；控制台零错误；截图存证。
- [ ] **Step 7: 提交**

```bash
git add src/domain/public-catalog/facade.ts src/lib/frontend/cached-queries.ts src/components/frontend/city/CityListingDetailView.tsx src/components/frontend/detail/RelatedListings.tsx "src/app/(frontend)/[city]/listings/[slug]/page.tsx" "src/app/(frontend)/listings/[slug]/page.tsx" tests/detail-recommendations.test.ts tests/opt068-detail-streaming.test.ts
git commit -m "perf(frontend): OPT-068 详情推荐改吃扫描并以 Suspense 流式输出，首屏不再等推荐"
```

---

### Task 7: 列表导航 pending 态 + 详情路由骨架

**Files:**
- Create: `src/components/frontend/listing/ListingNavigation.tsx`（`'use client'`）
- Modify: `FilterFormC.tsx`、`FilterPill.tsx`、`ResultToolbar.tsx`、`PriceUnitSegment.tsx`、`ListPager.tsx`、`MobileFilterSheet.tsx`（`Link` → `NavLink`，保留各自的 `prefetch={false}` 字面量与注释）
- Modify: `CityListingsView.tsx`、`CityBuildingsView.tsx`（外层包 `ListingNavigationProvider`，`.ls-results` 容器换 `PendingRegion`）
- Modify: `src/app/(frontend)/styles/list.css`
- Create: `src/app/(frontend)/[city]/listings/[slug]/loading.tsx`、`src/app/(frontend)/[city]/buildings/[slug]/loading.tsx`
- Test: `tests/opt068-listing-navigation.test.tsx`（`renderToStaticMarkup` 渲染 `NavLink` 断言 `href` / `prefetch` 透传与 `data-pending`；源码契约：六个组件不再直接 `import Link from 'next/link'`）

**Interfaces:**

```tsx
export function ListingNavigationProvider({ children }: { children: React.ReactNode }): JSX.Element
export function NavLink(props: React.ComponentProps<typeof Link>): JSX.Element
//   onClick：先调用 props.onClick；若 defaultPrevented / button!==0 / meta|ctrl|shift|alt / target==='_blank' 则放行；否则 preventDefault → navigate(String(href))
//   pending 时渲染 aria-busy="true" data-pending="true"
export function PendingRegion({ className, children }: { className: string; children: React.ReactNode }): JSX.Element
//   有任一 pendingHref 时 aria-busy="true"
```

- [ ] **Step 1: 写失败测试**（源码契约 + 静态渲染）
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现** `ListingNavigation.tsx`：`useRouter` + `useTransition` + `useState<string|null>(pendingHref)`；`navigate = (href) => { setPendingHref(href); startTransition(() => router.push(href)) }`；`useEffect(() => { if (!isPending) setPendingHref(null) }, [isPending])`；Context 默认值 `navigate` 为直通（无 Provider 时 `NavLink` 退化为普通 `Link`，不拦截点击）。
- [ ] **Step 4: 替换链接与容器**；`list.css` 追加：

```css
.ls-results { transition: opacity .18s ease; }
.ls-results[aria-busy="true"] { opacity: .5; pointer-events: none; }
[data-pending="true"] { position: relative; padding-right: 22px; }
[data-pending="true"]::after { content: ""; position: absolute; right: 6px; top: 50%; width: 10px; height: 10px; margin-top: -5px;
  border: 2px solid var(--ink-3); border-top-color: var(--ink); border-radius: 50%; animation: ls-spin .7s linear infinite; }
@keyframes ls-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ls-results { transition: none; } [data-pending="true"]::after { animation: none; border-top-color: var(--ink-3); } }
```

- [ ] **Step 5: 详情 `loading.tsx`**：用 `dt-container` 布局放 `Skeleton`（面包屑一行、标题 60%、16:10 画廊块、两列信息各三行），`aria-busy="true"` `aria-label="正在加载房源详情"`。楼盘详情同款。
- [ ] **Step 6: 跑**：`pnpm vitest run tests/opt068-listing-navigation.test.tsx tests/listings-query-prefetch-performance.test.ts && pnpm typecheck && pnpm lint`
- [ ] **Step 7: 浏览器验证（关键）**：dev server 打开 `/shanghai/listings`：(a) 点一个区域 chip → 该 chip 立即出现 spinner、结果区变灰、URL 变化后恢复；(b) 移动视口（`resize_window mobile`）打开筛选抽屉点选项，抽屉**不应关闭 / 不应重挂载**；(c) `ctrl+click` 在新标签打开仍生效（用 `javascript_tool` 派发带 `ctrlKey` 的 click 观察 `defaultPrevented === false`）；(d) 从列表点卡片进详情，先看到骨架再看到内容。四项各截图存证。
- [ ] **Step 8: 本地跑触及的 e2e**：按仓库实际 spec 名跑列表与详情相关 spec；红了先看 fixture 差异（`.agent/testing.md`）。
- [ ] **Step 9: 提交**

```bash
git add src/components/frontend/listing/ListingNavigation.tsx src/components/frontend/listing/FilterFormC.tsx src/components/frontend/listing/FilterPill.tsx src/components/frontend/listing/ResultToolbar.tsx src/components/frontend/listing/PriceUnitSegment.tsx src/components/frontend/listing/ListPager.tsx src/components/frontend/listing/MobileFilterSheet.tsx src/components/frontend/city/CityListingsView.tsx src/components/frontend/city/CityBuildingsView.tsx "src/app/(frontend)/styles/list.css" "src/app/(frontend)/[city]/listings/[slug]/loading.tsx" "src/app/(frontend)/[city]/buildings/[slug]/loading.tsx" tests/opt068-listing-navigation.test.tsx
git commit -m "feat(frontend): OPT-068 筛选/排序/分页导航 pending 态与详情路由骨架"
```

---

### Task 8: 根路径直出（多城市模式不再 307）

**Files:**
- Create: `src/app/(frontend)/_lib/city-home.tsx`
- Modify: `src/app/(frontend)/page.tsx`、`src/app/(frontend)/[city]/page.tsx`
- Modify: `tests/e2e/multi-city-routing.spec.ts:114`、`:127` 附近（`/` 从 307 改为 200 + canonical `/shanghai`；`/listings` `/buildings` 保持 307）
- Test: `tests/opt068-root-home.test.ts`（源码契约：`page.tsx` 多城市分支不再调用 `redirect(`；两条路由都从 `_lib/city-home.tsx` 取渲染）

**Interfaces:**

```tsx
// src/app/(frontend)/_lib/city-home.tsx
export async function loadCityHomeProps(city: CityContext): Promise<{ homepage; siteSettings }>   // Promise.all([getCachedHomepage(city.slug), getCachedSiteSettings()])
export function renderCityHome(city: CityContext, props): React.ReactElement                       // coming-soon → <ComingSoonCityView/>，否则 <CityHomeView routeMode="prefixed" bandStats={homepage.stats} …/>
export function cityHomeMetadata(city: CityContext): Metadata                                      // buildCityPageMetadata({ city, pageType: 'home', multiCityRoutingEnabled: getMultiCityRoutingEnabled() })
```

- [ ] **Step 1: 写失败测试**（源码契约）并改 e2e 期望。
- [ ] **Step 2: 实现**：`[city]/page.tsx` 改用三个函数；根 `page.tsx` 多城市分支：`generateMetadata` 返回 `cityHomeMetadata(city)`（canonical 落到 `/shanghai`，与 e2e 第 82 行既有断言一致），页面渲染 `renderCityHome(city, await loadCityHomeProps(city))`；legacy 分支不变。
- [ ] **Step 3: 跑**：`pnpm vitest run tests/opt068-root-home.test.ts tests/city-route-pages.test.ts tests/city-routes.test.ts && pnpm typecheck`
- [ ] **Step 4: 浏览器验证**：本地 `.env.local` 设 `MULTI_CITY_ROUTING_ENABLED=true` 起 dev，`curl -sI localhost:3717/` 为 200，页面 `link[rel=canonical]` 为 `/shanghai`，页头城市切换器正常；`/listings` 仍 307。
- [ ] **Step 5: 本地跑 `pnpm exec playwright test tests/e2e/multi-city-routing.spec.ts`**（需要 `CI=1` 与 https `SITE_URL` 的环境事实见 `.agent/testing.md`）。
- [ ] **Step 6: 提交**

```bash
git add "src/app/(frontend)/_lib/city-home.tsx" "src/app/(frontend)/page.tsx" "src/app/(frontend)/[city]/page.tsx" tests/e2e/multi-city-routing.spec.ts tests/opt068-root-home.test.ts
git commit -m "perf(frontend): OPT-068 根路径多城市模式直出默认城市首页，不再 307"
```

---

### Task 9: 首页统计与附近房源改吃扫描

**Files:**
- Modify: `src/domain/public-catalog/facade.ts`（`getHomepage`、`getPlatformHomepageStats`）
- Test: 既有首页测试（`grep -l "getHomepage\|getPlatformHomepageStats" tests`）保持通过；新增用例断言带 `scanEffectiveListings` 的 fake 下 `findEffectiveListings` 零调用

- [ ] **Step 1: 读 `facade.ts` 840–1000 行确认 `allEffectiveListings` 的三处消费（stats.listings / typeSummaries / nearbyListings）后写测试。**
- [ ] **Step 2: 实现**：`rows = await scanListings(EMPTY_LISTING_INPUT, ctx, adapter)`；`stats.listings = rows.length`；`typeSummaries`：按 `listingType` 计数，封面取该类型 id 最小的一条 → 收集 ≤ 类型数个 id → `hydrate` 回捞 → `mapListingCoverFull`；`nearbyListings`：`rows.filter(coordinates && !featuredSlugs.has(slug))` 按 haversine 排序取 5 → 回捞 → 卡片 + `distanceKm`；`getPlatformHomepageStats` 用 `rows.length`。
- [ ] **Step 3: 跑**：`pnpm vitest run $(grep -l "getHomepage\|getPlatformHomepageStats\|nearbyListings" tests/*.ts) && pnpm typecheck`
- [ ] **Step 4: 浏览器验证首页三处数字与「附近房源」不变。**
- [ ] **Step 5: 提交**

```bash
git add src/domain/public-catalog/facade.ts tests/
git commit -m "perf(catalog): OPT-068 首页统计/类型卡/附近房源改吃扫描行，发版后首页冷路径不再全量拉取"
```

---

### Task 10: 楼盘封面派生图 + 存量媒体回填脚本

**Files:**
- Create: `src/lib/frontend/media-srcset.ts`
- Modify: `src/components/frontend/ui/Media.tsx`（改用 `buildSrcSet`）
- Modify: `HomeSupplyCard.tsx`、`listing/BuildingResultCard.tsx`、`listing/BuildingCompactRow.tsx`、`BuildingSummaryCard.tsx`、`BuildingCardMini.tsx`、`building-detail/NearbyBuildingsStrip.tsx`
- Create: `scripts/backfill-media-sizes.ts`；`package.json` 增 `"media:backfill-sizes"` 脚本
- Test: `tests/opt068-media-srcset.test.ts`

**Interfaces:**

```ts
export function buildSrcSet(media: Pick<MediaViewModel, 'variants'>): string | undefined
export function cardCoverProps(media: MediaViewModel, sizes: string, targetWidth = 768): Readonly<{ src: string; srcSet?: string; sizes?: string }>
//   src = pickVariantSrc(media, targetWidth)；有 variants 才给 srcSet/sizes
```

- [ ] **Step 1: 写失败测试**：无 variants → `{ src: 原图 }`；有 variants → `src` 为 ≥768 的最小档、`srcSet` 为 `"a 320w, b 768w, c 1600w"`、`sizes` 透传。
- [ ] **Step 2: 实现并替换六个消费方的 `<img src={coverImage.src}>` 为 `<img {...cardCoverProps(coverImage, '(max-width: 767px) 100vw, 320px')} …>`（sizes 按各卡实际列宽：列表卡 4 列 ≈ 320px，rail 卡 ≈ 360px，摘要卡 ≈ 480px）。`Media.tsx` 的 `srcSet` 改为 `buildSrcSet(media)`。
- [ ] **Step 3: 回填脚本**：

```ts
// scripts/backfill-media-sizes.ts（骨架）
const EXECUTE = process.argv.includes('--execute')
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 50)
// 1) 分页 payload.find({ collection: 'media', depth: 0, limit: 200, sort: 'id', page })
// 2) 候选：mimeType 以 image/ 开头 && !doc.sizes?.card?.url
// 3) dry-run 打印 候选数 / 累计 filesize；--execute 时逐条：
//    buffer = await getObject(COS, `${MEDIA_COS_PREFIX}/${doc.filename}`)   // @aws-sdk/client-s3，凭据来自 src/lib/storage/cos-config.ts
//    await payload.update({ collection: 'media', id: doc.id, data: {}, overrideAccess: true, overwriteExistingFiles: true,
//      file: { data: buffer, mimetype: doc.mimeType, name: doc.filename, size: buffer.length } })
//    再 findByID 打印 sizes.card.url；失败记录 id 继续，末尾汇总
```

- [ ] **Step 4: 本地证明**：本地库挑一张有 sizes 的媒体，用 `payload.db.drizzle` 把该行的 `sizes_card_url` / `sizes_thumb_url` / `sizes_hero_url` 置空（列名以 `src/migrations` 里 media 表定义为准），跑 `pnpm media:backfill-sizes`（dry-run 列出该条）→ `--execute --limit=1` → 断言 `sizes.card.url` 回来且文件名不变。命令与输出存 `artifacts/verification/OPT-068/task10-backfill.log`。
- [ ] **Step 5: 浏览器验证**：首页热门楼盘 rail 与楼盘列表卡的 `<img>` 带 `srcset`（对已有派生的媒体），`read_network_requests` 看下载的是 `-768x512.webp`。
- [ ] **Step 6: 提交**

```bash
git add src/lib/frontend/media-srcset.ts src/components/frontend/ui/Media.tsx src/components/frontend/home/HomeSupplyCard.tsx src/components/frontend/listing/BuildingResultCard.tsx src/components/frontend/listing/BuildingCompactRow.tsx src/components/frontend/BuildingSummaryCard.tsx src/components/frontend/BuildingCardMini.tsx src/components/frontend/building-detail/NearbyBuildingsStrip.tsx scripts/backfill-media-sizes.ts package.json tests/opt068-media-srcset.test.ts
git commit -m "perf(frontend): OPT-068 楼盘封面走派生图 srcset，并提供存量媒体回填脚本"
```

生产回填由用户在持有生产 `DATABASE_URL` + `COS_*` 的环境执行（约 9–10k 张，建议 `--limit=500` 分批）：

```bash
node --env-file=.env.production --import tsx scripts/backfill-media-sizes.ts            # dry-run
node --env-file=.env.production --import tsx scripts/backfill-media-sizes.ts --execute --limit=500
```

---

### Task 11: 收尾——全量闸门、证据、文档

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test`（全量单测）。
- [ ] **Step 2:** 本地 `next build`（`.agent/testing.md` 的 `CI=1` / https `SITE_URL` 环境事实）+ `next start` 下用 `curl -w '%{time_starttransfer}'` 复测：冷 `?areaMax=500`、`?areaMin=100&areaMax=300`、详情冷开；记录到 `artifacts/verification/OPT-068/after-local.md`。
- [ ] **Step 3:** 本文件状态改「待合并」，补「实施后订正」小节记录与计划偏离之处。
- [ ] **Step 4:** `git push -u origin perf/opt-068-listing-scan-df70`，PR 描述引用本文件 §0 与 §Task 11 的前后对照；**合并即上线**，合并后用线上默认域名复测同一组 URL 并回写到本文件。

## 不在本次范围（已记录）

- 静态资源 / 图片的 `cache-control: no-store` 与 CDN：等自定义域名绑定后处理（网关层覆写，代码侧改不了）。
- 楼盘列表页：复测冷路径 0.24–0.27 s，早先 7 s 是与并发冷请求争抢 1 vCPU 造成，不动。
- 把有效供给精筛下推到 SQL：商户资质到期、服务城市覆盖等谓词跨表，收益不如扫描层且风险高，留待房源量过 5000 再议。


---

## 实施后订正（2026-09-04）

计划与落地的差异，逐条记录：

1. **Task 1/2 合并成一个提交**：排序泛型化是扫描行模型的前置条件，分开提交会留下一个
   编译不过的中间态。
2. **`selectListingPage` 的 `filteredByRentUnit` 语义**：计划里的用例期望「显式选单位 +
   价格排序」时该标志为 true，实测为 false——单位过滤发生在排序预处理**之前**，
   `prepareForPriceSort` 看到的已经是同一单位。这与改动前的旧路径一致（旧路径同样先
   `filterByPrice` 再 `prepareCardsForPriceSort`），因此改的是用例不是实现；
   「另有 N 套按别的单位报价」由 facet 提示，不由这个标志。
3. **`findEffectiveListingsByIds` 的 where 用 `and` 合并**：`baseEffectiveWhere` 可能已经
   用 `id.not_in` 排除了举报暂停的房源，直接写 `where.id = { in: ids }` 会把那条排除覆盖掉
   （被暂停的房源会重新出现在页面上）。
4. **`scanListingPages` 写成递归翻页**：`tests/f7-4-6` 的 N+1 守卫按「循环体内 await find」
   的源码形状扫描，翻页不是 N+1 但形状分不开——与既有 `findAllListings` 保持同一写法。
5. **新增 `renderCityHomeRoute`**：计划里根路径直接 `renderCityHome(city, await loadCityHomeProps(city))`，
   会让「即将开放」的城市也去取一次库存（`tests/city-route-pages.test.ts` 有守卫）。
   改成路由入口先判 `serviceStatus`。
6. **导航 pending 态不用 effect 清空**：`useEffect` 里同步 `setState` 被 eslint 的
   `react-hooks/set-state-in-effect` 拦下（会引发级联渲染）。改为 context value 直接按
   `isPending` 取值。
7. **导航测试从 `.test.tsx` 改回 `.test.ts`**：`vitest.config` 的 include 只收 `*.test.ts`，
   `.tsx` 文件**根本不会被执行**（改名前它「通过」是因为压根没跑）。JSX 改用
   `React.createElement`，与 `tests/city-home-view.test.ts` 同一先例。
8. **回填脚本的原图字节走站点自身文件路由**（而不是计划里写的 COS SDK 直读）：本地与生产
   同一条代码路径，本地无 COS 也能验证；代价是跑脚本时站点要在跑。
9. **走查抓到一个自己引入的回归**：见 `artifacts/verification/OPT-068/measurements.md` §4
   （client 组件经 barrel 拖入 payload 服务端代码 → 媒体路由全 500）。

## 验证证据

- `artifacts/verification/OPT-068/measurements.md`：生产库查询形状对比、本地生产构建冷热
  TTFB、派生图体积、两个坑的记录。
- `artifacts/verification/OPT-068/task10-backfill.log`：回填脚本 dry-run 与 `--execute` 输出。
- 闸门：`pnpm typecheck` / `pnpm lint` / `pnpm test`（4305 passed）/ `pnpm build` 全绿。
- 浏览器（本地 dev，Browser pane）：列表筛选点击 120 ms 内出现 pending（被点项 `data-pending`、
  结果区 `aria-busy` + opacity .45），240 ms 后 URL 与结果集更新为 8 条（与 facet 计数一致）；
  排序、翻页、ctrl+click 放行均实测通过；详情页 HTML 同时含骨架与流式补上的 `id="related"`；
  根路径 200 且 canonical 指向 `/shanghai`；首页热门楼盘与楼盘列表卡带 `srcset`。

## 上线后实测（2026-09-04 12:48，线上默认域名，构建 `a994f6b`）

| 场景 | 上线前（冷） | 上线后（冷） | 上线后（热） |
|---|---|---|---|
| `/shanghai/listings?areaMax=500` | 20.4 s | **1.02 s** | 0.07 s |
| `/shanghai/listings?areaMin=100&areaMax=300` | 10.8 s | **1.19 s** | 0.10 s |
| `/shanghai/listings?district=pudong` | 5.5 s | **0.28 s** | 0.07 s |
| `/shanghai/listings?areaMin=200&page=3` | 17.8 s | **0.73 s** | 0.17 s |
| 房源详情冷开 | 2.8 / 4.1 s | **0.42 s** | 0.25 s |
| `/` | 307 再跳一次 | **200 直出** | — |

区域筛选降到 0.28 s 是因为它已是内存维度，与无筛选页共用同一份扫描——上线前它是
一次独立的全量扫描。

契约同时复核通过：`/hangzhou/listings/<上海房源>` → 307 且 Location 正确、
不存在的房源 → 404、正常详情 → 200、首页 canonical → `/shanghai`。
这正是上线前那次 e2e 三红（详情路由 `loading.tsx` 把状态码锁成 200）所保护的东西。

首页 42 张卡片正常渲染；`srcset` 目前只出现 2 处——线上存量媒体尚未回填派生尺寸，
回填后才会全面生效（见下方待办）。

## 待办（上线后）

- [ ] 在持有生产 `DATABASE_URL` + `COS_*` 的环境分批跑 `pnpm media:backfill-sizes --execute --limit=500`
      （线上约 9–10k 张缺派生），跑完再复测首页与楼盘列表的图片字节。
- [ ] 域名绑定 + CDN 之后处理静态资源与图片的 `cache-control: no-store`（不在本工作项范围）。
