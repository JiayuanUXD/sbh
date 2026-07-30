# 房源与楼盘详情 P0 核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Next.js + Payload 单体中完成结构化房源/楼盘详情、楼内供给分组比较、两步咨询降级、SEO、响应式和统一有效供给闭环。

**Architecture:** Collection 只维护结构化事实，`domain/public-catalog` 是前台唯一 DTO/查询门面，页面 Server Component 只编排 DTO，交互收敛到小型 Client Component。楼盘数量、区间、分组列表、推荐、咨询复核和 sitemap 全部复用统一有效供给服务与同一 `SearchContext.asOf`。

**Tech Stack:** Next.js 16、React 19、Payload 3.86、PostgreSQL、TypeScript 5.9、Vitest 4、Playwright 1.61、原生 CSS。

## Global Constraints

- 开始执行前使用 `using-git-worktrees` 从最新 `origin/master` 创建 `codex/detail-pages-p0-core`，使用独立端口和独立 PostgreSQL 数据库。
- 包管理器固定为 pnpm 8.6.1；Node.js 22.x；不得引入新 UI 库、Tailwind reset 或全局第三方 CSS reset。
- 前台页面和组件只消费只读 Public Catalog DTO；不得接收原始 Payload 文档或拼 Payload `where`。
- 公开供给最长缓存 5 分钟，并由领域事件按 listing/building 精准失效；禁止旧 `status=available` 降级查询。
- 价格始终携带币种、租售类型、周期和单位；禁止跨单位聚合或排序。
- PII 不得进入 URL、埋点、公开 DTO、地图请求、前端日志或错误响应。
- Collection 变化必须通过 `pnpm exec payload migrate:create` 生成显式迁移，迁移正文不得手改。
- 视口验收固定为 375×812、768×1024、1440×900、1920×1080；目标 WCAG 2.2 AA。
- 证据写入 `artifacts/verification/FPD-P0/README.md`，任务包写入 `specs/work-items/FPD-P0-detail-pages-core.md`。

---

## File Map

| 文件 | 单一职责 |
|---|---|
| `src/collections/Listings.ts` | 房源结构化空间、费用、注册、媒体和核验字段 |
| `src/collections/Buildings.ts` | 楼盘规模、电梯、服务、认证、媒体和核验字段 |
| `src/domain/public-catalog/detail-values.ts` | 费用、面积、工位和价格换算纯函数 |
| `src/domain/public-catalog/contracts.ts` | 房源/楼盘详情和供给分组只读 DTO |
| `src/domain/public-catalog/mappers.ts` | Payload 文档到公开 DTO 的白名单映射 |
| `src/domain/public-catalog/search-params.ts` | 旧租金 URL 参数到结构化价格 key 的兼容解析 |
| `src/domain/public-catalog/stable-sort.ts` | 同完整价格 key 内的稳定排序 |
| `src/domain/public-catalog/building-supply.ts` | 楼盘供给分组、筛选、排序和聚合 |
| `src/domain/public-catalog/facade.ts` | 详情、推荐、聚合查询编排 |
| `src/domain/inquiry/schema.ts` | 两步咨询上下文、需求字段和错误码白名单 |
| `src/app/(frontend)/api/inquiries/route.ts` | 提交时目标复核和房源→楼盘降级 |
| `src/components/frontend/DetailGallery.tsx` | 分类图片画廊和可访问全屏 |
| `src/components/frontend/DetailAnchorNav.tsx` | 可见模块驱动的锚点导航 |
| `src/components/frontend/DetailFacts.tsx` | 结构化事实与缺失降级 |
| `src/components/frontend/BuildingSupplyBrowser.tsx` | 楼内供给分组、URL 筛选和排序 |
| `src/components/frontend/InquiryModal.tsx` | 两步表单、错误聚焦、降级提示和成功摘要 |
| `src/app/(frontend)/listings/[slug]/page.tsx` | 房源详情编排、metadata 和 JSON-LD |
| `src/app/(frontend)/buildings/[slug]/page.tsx` | 楼盘详情编排、metadata 和 JSON-LD |
| `src/app/(frontend)/styles.css` | 详情页布局、断点、焦点和减少动效 |
| `tests/detail-values.test.ts` | 换算、缺失和估算口径 |
| `tests/frontend-mappers.test.ts` | 公开字段白名单和媒体分类映射 |
| `tests/building-supply.test.ts` | 供给分组、聚合、筛选和跨单位排序 |
| `tests/inquiry-domain.test.ts` | 咨询上下文 schema |
| `tests/inquiry-api-route.test.ts` | 提交复核与楼盘降级 |
| `tests/detail-pages-seo.test.ts` | metadata 和 JSON-LD 纯函数 |
| `tests/e2e/detail-pages.spec.ts` | 两个详情页核心浏览器路径 |

---

### Task 1: 建立任务包和结构化字段

**Files:**
- Create: `specs/work-items/FPD-P0-detail-pages-core.md`
- Modify: `payload-office-platform/src/collections/Listings.ts`
- Modify: `payload-office-platform/src/collections/Buildings.ts`
- Modify: `payload-office-platform/src/domain/review/listing-fields.ts`
- Test: `payload-office-platform/tests/listing-protect.test.ts`
- Test: `payload-office-platform/tests/building-protect.test.ts`
- Generated: `payload-office-platform/src/migrations/*_detail_page_fields.ts`
- Generated: `payload-office-platform/src/migrations/*_detail_page_fields.json`
- Modify: `payload-office-platform/src/migrations/index.ts`

**Interfaces:**
- Produces: `Listing.spaceDetails`, `Listing.costTerms`, `Listing.registrationStatus`, `Listing.mediaItems`, `Listing.verificationInfo`.
- Produces: `Building.developerAndScale`, `Building.verticalTransport`, `Building.buildingServices`, `Building.certifications`, `Building.mediaItems`, `Building.verificationInfo`.
- Consumes: existing `price`, `area`, `seats`, `floor`, `minimumLeaseMonths`, `paymentTerms`, `availableFrom`, `gallery`, `amenities`.

- [ ] **Step 1: 写失败的 Collection 保护测试**

```ts
it('拒绝非法得房率和反向工位区间', async () => {
  await expect(runListingProtect({
    spaceDetails: { efficiencyRate: 101, seatMin: 30, seatMax: 20 },
  })).rejects.toThrow('得房率必须在 0–100 之间')
})

it('拒绝过期楼盘认证作为公开认证', async () => {
  await expect(runBuildingProtect({
    certifications: [{
      name: 'LEED',
      validTo: '2026-01-01T00:00:00.000Z',
      publicVisible: true,
    }],
  }, new Date('2026-07-30T00:00:00.000Z'))).rejects.toThrow('过期认证不可公开')
})
```

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```bash
cd payload-office-platform
pnpm test -- tests/listing-protect.test.ts tests/building-protect.test.ts
```

Expected: FAIL，提示字段不存在或保护函数尚未校验新字段。

- [ ] **Step 3: 增加枚举和 Collection 字段**

在 `listing-fields.ts` 增加：

```ts
export const REGISTRATION_STATUSES = [
  'available',
  'conditional',
  'unavailable',
  'confirm',
] as const

export const COST_INCLUSION_STATUSES = [
  'included',
  'excluded',
  'confirm',
] as const

export const DETAIL_MEDIA_KINDS = ['image', 'floor-plan', 'video'] as const
export const LISTING_MEDIA_CATEGORIES = [
  'workspace',
  'meeting-room',
  'common-area',
  'exterior',
] as const
```

在 `Listings.ts` 的现有 tabs 内加入以下组，字段全部使用 Payload 原生 `group` / `array` / `select` / `number`，不另建自由 JSON：

```ts
{
  name: 'spaceDetails',
  type: 'group',
  fields: [
    { name: 'efficiencyRate', type: 'number', min: 0, max: 100 },
    { name: 'seatMin', type: 'number', min: 0 },
    { name: 'seatMax', type: 'number', min: 0 },
    { name: 'orientation', type: 'text', maxLength: 30 },
    { name: 'netCeilingHeight', type: 'number', min: 0 },
    { name: 'isDivisible', type: 'checkbox', defaultValue: false },
    { name: 'furnitureStatus', type: 'select', options: ['included', 'optional', 'none', 'confirm'] },
  ],
},
{
  name: 'costTerms',
  type: 'group',
  fields: [
    { name: 'depositMonths', type: 'number', min: 0 },
    { name: 'propertyFeeInclusion', type: 'select', options: COST_INCLUSION_STATUSES },
    { name: 'propertyFeeAmount', type: 'number', min: 0 },
    { name: 'invoiceStatus', type: 'select', options: ['included', 'extra-tax', 'unavailable', 'confirm'] },
    { name: 'otherFixedCosts', type: 'textarea', maxLength: 500 },
  ],
},
```

`Buildings.ts` 增加：

```ts
{
  name: 'developerAndScale',
  type: 'group',
  fields: [
    { name: 'developer', type: 'text', maxLength: 100 },
    { name: 'grossFloorArea', type: 'number', min: 0 },
    { name: 'typicalFloorArea', type: 'number', min: 0 },
    { name: 'standardFloorHeight', type: 'number', min: 0 },
    { name: 'netCeilingHeight', type: 'number', min: 0 },
    { name: 'efficiencyRate', type: 'number', min: 0, max: 100 },
  ],
},
{
  name: 'verticalTransport',
  type: 'group',
  fields: [
    { name: 'passengerElevators', type: 'number', min: 0 },
    { name: 'freightElevators', type: 'number', min: 0 },
    { name: 'zoningNote', type: 'textarea', maxLength: 300 },
  ],
},
```

两个 Collection 的 `mediaItems` 项统一为：

```ts
{
  name: 'mediaItems',
  type: 'array',
  maxRows: 40,
  fields: [
    { name: 'resource', type: 'upload', relationTo: 'media', required: true },
    { name: 'kind', type: 'select', required: true, options: DETAIL_MEDIA_KINDS },
    { name: 'category', type: 'select', required: true, options: /* listing 或 building 分类 */ },
    { name: 'alt', type: 'text', required: true, maxLength: 160 },
    { name: 'capturedAt', type: 'date' },
    { name: 'isSchematic', type: 'checkbox', defaultValue: false },
  ],
}
```

- [ ] **Step 4: 生成类型和迁移**

Run:

```bash
cd payload-office-platform
pnpm exec payload generate:types
pnpm exec payload migrate:create detail-page-fields
```

Expected: `src/payload-types.ts` 更新；生成器输出一对 `detail_page_fields` 迁移文件并更新 `src/migrations/index.ts`。保留生成器给出的实际路径，禁止手改迁移正文。

- [ ] **Step 5: 跑绿并提交**

Run:

```bash
pnpm test -- tests/listing-protect.test.ts tests/building-protect.test.ts
pnpm typecheck
```

Expected: PASS。

```bash
git add specs/work-items/FPD-P0-detail-pages-core.md \
  payload-office-platform/src/collections/Listings.ts \
  payload-office-platform/src/collections/Buildings.ts \
  payload-office-platform/src/domain/review/listing-fields.ts \
  payload-office-platform/src/domain/review/listing-protect.ts \
  payload-office-platform/src/domain/supply/building-protect.ts \
  payload-office-platform/src/payload-types.ts \
  payload-office-platform/src/migrations/index.ts \
  payload-office-platform/src/migrations/*detail_page_fields*
git commit -m "feat: add structured detail page fields"
```

---

### Task 2: 建立详情值对象和公开 DTO

**Files:**
- Create: `payload-office-platform/src/domain/public-catalog/detail-values.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/contracts.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/mappers.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/search-params.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/stable-sort.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/index.ts`
- Test: `payload-office-platform/tests/detail-values.test.ts`
- Test: `payload-office-platform/tests/frontend-mappers.test.ts`
- Test: `payload-office-platform/tests/public-catalog-contract.test.ts`

**Interfaces:**
- Produces: `ListingDetailViewModel`, `BuildingDetailViewModel`, `DetailMediaViewModel`, `FactValue`, `VerificationViewModel`.
- Produces: `PriceViewModel` 的 `businessType + currency + period + basis + displayUnit` 完整价格 key；旧 `rentUnit` URL 继续兼容三种租赁单位。
- Produces: `computeUsableArea(area, efficiencyRate)`, `deriveSeatRange(input)`, `convertPrice(input)`.
- Consumes: Task 1 generated Payload types.

- [ ] **Step 1: 写值对象和白名单失败测试**

```ts
it('只在面积和得房率可信时计算套内参考面积', () => {
  expect(computeUsableArea(132, 70)).toEqual({ amount: 92.4, estimated: true })
  expect(computeUsableArea(132, null)).toBeNull()
})

it('元/工位/月不生成元/㎡/天换算', () => {
  expect(convertPrice({
    amount: 1800,
    currency: 'CNY',
    period: 'month',
    unit: 'seat',
    area: 100,
    seats: 20,
  })).toEqual([])
})

it('mapper 不公开 contactBroker 和审核字段', () => {
  const vm = mapListingDetail(LISTING_WITH_DETAIL_FIELDS)
  expect(vm).not.toHaveProperty('contactBroker')
  expect(vm).not.toHaveProperty('reviewStatus')
  expect(JSON.stringify(vm)).not.toContain('13800001111')
})
```

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
pnpm test -- tests/detail-values.test.ts tests/frontend-mappers.test.ts
```

Expected: FAIL，模块或字段尚不存在。

- [ ] **Step 3: 实现纯函数和 DTO**

`detail-values.ts` 的公共签名：

```ts
export type EstimatedNumber = Readonly<{ amount: number; estimated: true }>

export function computeUsableArea(
  area: number | null,
  efficiencyRate: number | null,
): EstimatedNumber | null

export function deriveSeatRange(input: Readonly<{
  seatMin: number | null
  seatMax: number | null
  suggestedSeats: number | null
  area: number | null
}>): Readonly<{ min: number; max: number; estimated: boolean }> | null

export function convertPrice(input: Readonly<{
  amount: number
  currency: 'CNY'
  period: 'day' | 'month' | 'year' | 'one-time'
  unit: 'sqm' | 'seat' | 'total'
  area: number | null
  seats: number | null
}>): readonly PriceViewModel[]
```

`contracts.ts` 增加：

```ts
export type PriceViewModel = Readonly<{
  amount: number
  currency: 'CNY'
  businessType: 'lease' | 'sale'
  period: 'day' | 'month' | 'year' | 'one-time'
  basis: 'sqm' | 'seat' | 'total'
  displayUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month' | 'rmb-total'
  text: string
}>

export type DetailMediaViewModel = Readonly<{
  id: string
  kind: 'image' | 'floor-plan' | 'video'
  category: string
  resource: MediaViewModel
  capturedAt: string | null
  isSchematic: boolean
}>

export type FactValue = Readonly<{
  label: string
  value: string | null
  estimated: boolean
  critical: boolean
}>

export type FactGroupViewModel = Readonly<{
  id: string
  title: string
  facts: readonly FactValue[]
}>

export type AmenityGroupViewModel = Readonly<{
  id: string
  title: string
  items: readonly string[]
}>

export type VerificationViewModel = Readonly<{
  verifiedAt: string | null
  priceVerifiedAt: string | null
}>

export type BuildingSupplyGroup = 'lease' | 'sale' | 'coworking'
```

`ListingCardViewModel` 同时增加只读 `businessType` 和 `decorationStatus`。`ListingDetailViewModel` 与 `BuildingDetailViewModel` 均增加 `mediaItems`、`factGroups`、`amenityGroups` 和 `verification`。所有空值使用 `null`，数组使用空数组，不暴露内部关系对象。`search-params.ts` 把旧 `rentUnit` 映射为 `period+basis`，`stable-sort.ts` 只对完整价格 key 相同的卡片排序。

- [ ] **Step 4: 实现 mapper**

`mappers.ts` 只读取 Task 1 字段；媒体映射按 `array` 顺序生成稳定 `id`：

```ts
function mapDetailMedia(
  items: unknown,
  fallbackAlt: string,
): readonly DetailMediaViewModel[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item, index) => {
    if (!isObject(item)) return []
    const resource = mapMedia(item.resource, fallbackAlt)
    if (!resource || !isDetailMediaKind(item.kind) || typeof item.category !== 'string') return []
    return [{
      id: `${resource.src}:${index}`,
      kind: item.kind,
      category: item.category,
      resource: { ...resource, alt: trimPublicText(item.alt) || resource.alt },
      capturedAt: typeof item.capturedAt === 'string' ? item.capturedAt : null,
      isSchematic: item.isSchematic === true,
    }]
  })
}
```

- [ ] **Step 5: 跑绿并提交**

Run:

```bash
pnpm test -- tests/detail-values.test.ts tests/frontend-mappers.test.ts
pnpm typecheck
```

Expected: PASS。

```bash
git add payload-office-platform/src/domain/public-catalog/detail-values.ts \
  payload-office-platform/src/domain/public-catalog/contracts.ts \
  payload-office-platform/src/domain/public-catalog/mappers.ts \
  payload-office-platform/src/domain/public-catalog/search-params.ts \
  payload-office-platform/src/domain/public-catalog/stable-sort.ts \
  payload-office-platform/src/domain/public-catalog/index.ts \
  payload-office-platform/tests/detail-values.test.ts \
  payload-office-platform/tests/frontend-mappers.test.ts \
  payload-office-platform/tests/public-catalog-contract.test.ts
git commit -m "feat: expose structured public detail DTOs"
```

---

### Task 3: 实现楼盘供给分组、聚合、筛选和排序

**Files:**
- Create: `payload-office-platform/src/domain/public-catalog/building-supply.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/contracts.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/facade.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/supply-adapter.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/index.ts`
- Test: `payload-office-platform/tests/building-supply.test.ts`
- Test: `payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts`

**Interfaces:**
- Produces: `buildBuildingSupplySnapshot(cards, input, asOf)`.
- Produces: `BuildingSupplySnapshot { asOf, groups, totalEffectiveListings }`.
- Produces: `getRelatedBuildings(slug, ctx, { limit: 6 }): Promise<readonly BuildingSummaryViewModel[]>`.
- Consumes: `ListingCardViewModel.businessType`, `price.currency`, `price.period`, `price.basis`, `price.displayUnit`.

- [ ] **Step 1: 写失败测试**

```ts
it('出租、出售和联合办公独立分组', () => {
  const snapshot = buildBuildingSupplySnapshot(
    [LEASE_CARD, SALE_CARD, COWORKING_CARD],
    { sort: 'recommended' },
    '2026-07-30T10:00:00.000Z',
  )
  expect(snapshot.groups.map((g) => g.key)).toEqual(['lease', 'sale', 'coworking'])
})

it('不同价格单位不合并且不共同排序', () => {
  const snapshot = buildBuildingSupplySnapshot(
    [MONTHLY_CARD, SQM_DAY_CARD],
    { sort: 'price-asc' },
    '2026-07-30T10:00:00.000Z',
  )
  expect(snapshot.validationErrors).toContain('price_unit_required')
  expect(snapshot.groups[0].priceRanges).toHaveLength(2)
})

it('周边楼盘只来自当前有效楼盘且排除自身', async () => {
  const result = await getRelatedBuildings('bund-soho', CTX, { limit: 6 }, ADAPTER)
  expect(result.map((item) => item.slug)).not.toContain('bund-soho')
  expect(result.map((item) => item.slug)).toEqual(['nearby-active-building'])
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test -- tests/building-supply.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现稳定接口**

```ts
export type BuildingSupplyInput = Readonly<{
  group?: BuildingSupplyGroup
  areaMin?: number
  areaMax?: number
  decorationStatus?: string
  availableBefore?: string
  priceUnit?: PriceViewModel['displayUnit']
  sort?: 'recommended' | 'area-asc' | 'area-desc' | 'price-asc' | 'price-desc'
}>

export function buildBuildingSupplySnapshot(
  cards: readonly ListingCardViewModel[],
  input: BuildingSupplyInput,
  asOf: string,
): BuildingSupplySnapshot
```

实现顺序固定为：有效卡片输入 → 租售/联合办公分组 → 条件过滤 → 价格单位校验 → 稳定排序 → 分组聚合。价格 range key 使用：

```ts
`${businessType}:${currency}:${period}:${basis}`
```

- [ ] **Step 4: Facade 只查询一次**

将 `getBuildingDetail` 返回值改为：

```ts
export type BuildingDetailResult = Readonly<{
  building: BuildingDetailViewModel | null
  supply: BuildingSupplySnapshot
}>
```

`findEffectiveListingsByBuilding` 只调用一次，所有分组和区间从同一 raw 集合产生。空楼盘返回 `emptyBuildingSupplySnapshot(ctx.asOf)`。

为相关楼盘在 `SupplyAdapter` 增加：

```ts
findEffectiveBuildingsNear(
  buildingId: number | string,
  ctx: SearchContext,
  limit: number,
): Promise<readonly Building[]>
```

默认适配器先读取当前楼盘商圈/行政区，再应用统一可公开 Building 谓词，排除自身并以距离信息（有坐标时）或稳定 ID 收束；不得从历史房源反推楼盘有效性。

- [ ] **Step 5: 跑一致性测试并提交**

```bash
pnpm test -- tests/building-supply.test.ts \
  tests/public-catalog-effective-supply-consistency.test.ts \
  tests/public-catalog-facade.test.ts
pnpm typecheck
```

Expected: PASS；同一失效 fixture 在详情、楼盘聚合、推荐、咨询候选中的 ID 集合一致。

```bash
git add payload-office-platform/src/domain/public-catalog/building-supply.ts \
  payload-office-platform/src/domain/public-catalog/contracts.ts \
  payload-office-platform/src/domain/public-catalog/facade.ts \
  payload-office-platform/src/domain/public-catalog/supply-adapter.ts \
  payload-office-platform/src/domain/public-catalog/index.ts \
  payload-office-platform/tests/building-supply.test.ts \
  payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts
git commit -m "feat: group and aggregate building supply"
```

---

### Task 4: 扩展咨询上下文和提交时降级

**Files:**
- Modify: `payload-office-platform/src/domain/inquiry/schema.ts`
- Modify: `payload-office-platform/src/domain/inquiry/privacy-log.ts`
- Modify: `payload-office-platform/src/app/(frontend)/api/inquiries/route.ts`
- Modify: `payload-office-platform/src/collections/Leads.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/facade.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/index.ts`
- Test: `payload-office-platform/tests/inquiry-domain.test.ts`
- Test: `payload-office-platform/tests/inquiry-api-route.test.ts`
- Generated: `payload-office-platform/src/migrations/*_inquiry_detail_context.ts`
- Generated: `payload-office-platform/src/migrations/*_inquiry_detail_context.json`

**Interfaces:**
- Produces: `InquiryRequest.source.section`, `priceSnapshot`, `activeSupplyGroup`, `currentFilters`.
- Produces response: `{ ok: true, targetResolution: 'listing' | 'building' | 'general' }`.
- Produces: `assertEffectiveBuilding(slug, ctx): Promise<BuildingDetailViewModel | null>`.
- Consumes: `assertEffectiveListing` and existing idempotency/limit services.

- [ ] **Step 1: 写 schema 和路由失败测试**

```ts
it('只接受白名单 section 和供给筛选', () => {
  const result = validateInquiry(buildValidInput({
    source: {
      pageType: 'building',
      path: '/buildings/bund-soho',
      section: 'supply-lease',
      currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
    },
  }))
  expect(result.ok).toBe(true)
})

it('房源失效但楼盘仍有效时创建楼盘需求', async () => {
  assertEffectiveListingMock.mockResolvedValue(null)
  assertEffectiveBuildingMock.mockResolvedValue({ id: 88, slug: 'bund-soho' })
  const response = await run(makeReq({
    body: makeValidBody({ listingSlug: 'expired', buildingSlug: 'bund-soho' }),
  }))
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ ok: true, targetResolution: 'building' })
  expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      targetType: 'building',
      targetListingSlug: null,
      targetBuildingSlug: 'bund-soho',
    }),
  }))
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test -- tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts
```

Expected: FAIL，schema 和 route 尚无新字段/降级结果。

- [ ] **Step 3: 扩展 schema 与隐私日志**

```ts
export const SOURCE_SECTIONS = [
  'hero',
  'sticky-card',
  'mobile-bar',
  'supply-lease',
  'supply-sale',
  'supply-coworking',
  'recommendation',
] as const

export type InquiryPriceSnapshot = Readonly<{
  amount: number
  currency: 'CNY'
  period: string
  unit: string
}>
```

`privacy-log.ts` 只记录 `has_price_snapshot`、`section`、`target_resolution`；不得序列化筛选原值、姓名、手机号或备注。

- [ ] **Step 4: 实现服务端复核和 Lead 映射**

顺序固定为：

```ts
const listing = request.listingSlug
  ? await assertEffectiveListing(request.listingSlug, ctx)
  : null
const building = !listing && request.buildingSlug
  ? await assertEffectiveBuilding(request.buildingSlug, ctx)
  : null
const targetResolution = listing ? 'listing' : building ? 'building' : 'general'
```

创建 Lead 时只保存最终有效目标；`priceSnapshot` 保存为非权威来源快照并记录提交时间，不参与公开价格。

- [ ] **Step 5: 生成迁移、跑绿并提交**

```bash
pnpm exec payload generate:types
pnpm exec payload migrate:create inquiry-detail-context
pnpm test -- tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts
pnpm typecheck
```

Expected: PASS；生成器产生询盘上下文迁移。

```bash
git add payload-office-platform/src/domain/inquiry/schema.ts \
  payload-office-platform/src/domain/inquiry/privacy-log.ts \
  'payload-office-platform/src/app/(frontend)/api/inquiries/route.ts' \
  payload-office-platform/src/collections/Leads.ts \
  payload-office-platform/src/domain/public-catalog/facade.ts \
  payload-office-platform/src/domain/public-catalog/index.ts \
  payload-office-platform/src/payload-types.ts \
  payload-office-platform/src/migrations/index.ts \
  payload-office-platform/src/migrations/*inquiry_detail_context* \
  payload-office-platform/tests/inquiry-domain.test.ts \
  payload-office-platform/tests/inquiry-api-route.test.ts
git commit -m "feat: preserve inquiry context and fallback targets"
```

---

### Task 5: 建立可复用详情组件

**Files:**
- Create: `payload-office-platform/src/components/frontend/DetailGallery.tsx`
- Create: `payload-office-platform/src/components/frontend/DetailAnchorNav.tsx`
- Create: `payload-office-platform/src/components/frontend/DetailFacts.tsx`
- Create: `payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx`
- Modify: `payload-office-platform/src/components/frontend/InquiryModal.tsx`
- Test: `payload-office-platform/tests/detail-components-contract.test.ts`

**Interfaces:**
- Produces: `<DetailGallery media title />`, `<DetailAnchorNav items />`, `<DetailFacts groups />`, `<BuildingSupplyBrowser snapshot />`.
- Consumes: Tasks 2–4 DTOs; no Payload imports.

- [ ] **Step 1: 写组件契约失败测试**

```ts
it('所有前台详情组件不导入 payload-types 或 payload', () => {
  for (const file of DETAIL_COMPONENT_FILES) {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/from ['"]payload['"]/)
    expect(source).not.toMatch(/payload-types/)
  }
})

it('空供给组不会生成 tab', () => {
  const html = renderToStaticMarkup(
    <BuildingSupplyBrowser snapshot={LEASE_ONLY_SNAPSHOT} />,
  )
  expect(html).toContain('出租')
  expect(html).not.toContain('出售')
  expect(html).not.toContain('联合办公')
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test -- tests/detail-components-contract.test.ts
```

Expected: FAIL，组件尚不存在。

- [ ] **Step 3: 实现组件边界**

`DetailAnchorNav` props：

```ts
type AnchorItem = Readonly<{ id: string; label: string; visible: boolean }>
type DetailAnchorNavProps = Readonly<{ items: readonly AnchorItem[] }>
```

`DetailFacts` props：

```ts
type Fact = Readonly<{
  label: string
  value: string | null
  estimated?: boolean
  critical?: boolean
}>
```

`critical=true && value=null` 渲染“咨询确认”；普通 null 不渲染。

`BuildingSupplyBrowser` 使用 `<form method="get">` 和 URL search params；客户端只增强 tab/折叠体验，不复制筛选事实到全局状态。

- [ ] **Step 4: 将 InquiryModal 改为两步**

状态使用：

```ts
type InquiryStep = 'contact' | 'requirements' | 'success'
```

第一步必填称呼、手机号、团队规模和隐私同意；第二步可选。服务端返回 `targetResolution` 后显示：

```ts
const resolutionCopy = {
  listing: '已记录这套房源，顾问将与您确认看房。',
  building: '该房源状态已变化，已为您登记同楼盘需求。',
  general: '目标状态已变化，已为您登记通用选址需求。',
}
```

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/detail-components-contract.test.ts tests/inquiry-domain.test.ts
pnpm typecheck
```

Expected: PASS。

```bash
git add payload-office-platform/src/components/frontend/DetailGallery.tsx \
  payload-office-platform/src/components/frontend/DetailAnchorNav.tsx \
  payload-office-platform/src/components/frontend/DetailFacts.tsx \
  payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx \
  payload-office-platform/src/components/frontend/InquiryModal.tsx \
  payload-office-platform/tests/detail-components-contract.test.ts
git commit -m "feat: add reusable detail page interactions"
```

---

### Task 6: 重构房源详情页

**Files:**
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/lib/frontend/format.ts`
- Test: `payload-office-platform/tests/format.test.ts`
- Test: `payload-office-platform/tests/e2e/detail-pages.spec.ts`

**Interfaces:**
- Consumes: `getListingBySlug`, `getRelatedListings`, Task 5 components.
- Produces: PRD FP-03 P0 页面结构和锚点。

- [ ] **Step 1: 写格式与 E2E 失败测试**

```ts
expect(formatFact(null, { critical: true })).toBe('咨询确认')
expect(formatFact(null, { critical: false })).toBeNull()
```

```ts
test('房源页展示结构化概况并保留咨询入口', async ({ page }) => {
  await page.goto('/listings/jingan-center-100-monthly')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('房源概况')).toBeVisible()
  await expect(page.getByRole('button', { name: '询价 / 预约看房' })).toBeVisible()
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test -- tests/format.test.ts
pnpm test:e2e -- tests/e2e/detail-pages.spec.ts --project=chromium
```

Expected: unit 或 E2E FAIL，页面缺少新结构。

- [ ] **Step 3: 按 PRD 顺序编排页面**

页面固定顺序：

```tsx
<Breadcrumb />
<section className="detail-hero">
  <DetailGallery media={listing.mediaItems} title={listing.title} />
  <DetailFacts groups={listing.factGroups} />
</section>
<DetailAnchorNav items={anchors} />
<section id="description"><RichText data={listing.description} /></section>
<section id="building"><Link href={`/buildings/${listing.building?.slug}`}>查看楼盘</Link></section>
<section id="related">{related.map((item) => <ListingCard key={item.id} listing={item} />)}</section>
<InquiryModal pageType="listing" targetListingSlug={listing.slug} targetBuildingSlug={listing.building?.slug} />
```

若 `mediaItems` 为空，兼容读取旧 `gallery` DTO；不得回读 Payload 原文档。

- [ ] **Step 4: 验证失效、价格面议和窄屏**

Run:

```bash
pnpm test:e2e -- tests/e2e/detail-pages.spec.ts --project=chromium
```

Expected: 有效房源 200、失效房源 404、价格面议不出现“0 元”、375px 无横向溢出。

- [ ] **Step 5: 提交**

```bash
git add 'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  payload-office-platform/src/lib/frontend/format.ts \
  payload-office-platform/tests/format.test.ts \
  payload-office-platform/tests/e2e/detail-pages.spec.ts
git commit -m "feat: expand listing detail decisions"
```

---

### Task 7: 重构楼盘详情页

**Files:**
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/components/frontend/ListingCard.tsx`
- Test: `payload-office-platform/tests/building-supply.test.ts`
- Test: `payload-office-platform/tests/e2e/detail-pages.spec.ts`

**Interfaces:**
- Consumes: `getBuildingDetail(): { building, supply }`.
- Produces: PRD FP-04 P0 页面、出租/出售/联合办公独立分组。

- [ ] **Step 1: 写楼盘页 E2E 失败测试**

```ts
test('楼盘页按有效供给显示非空分组', async ({ page }) => {
  await page.goto('/buildings/jingan-center')
  await expect(page.getByRole('heading', { name: '当前有效供给' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '出租' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '出售' })).toHaveCount(0)
})

test('无供给楼盘不显示最低价和空 tab', async ({ page }) => {
  await page.goto('/buildings/empty-building')
  await expect(page.getByText('当前暂无公开可选空间')).toBeVisible()
  await expect(page.getByText('最低价')).toHaveCount(0)
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test:e2e -- tests/e2e/detail-pages.spec.ts --project=chromium
```

Expected: FAIL，现有页面只有“在租房源”。

- [ ] **Step 3: 按 PRD 编排楼盘页面**

```tsx
<section className="detail-hero">
  <DetailGallery media={building.mediaItems} title={building.name} />
  <DetailFacts groups={building.factGroups} />
</section>
<DetailAnchorNav items={anchors} />
<BuildingSupplyBrowser snapshot={supply} />
<section id="description"><RichText data={building.description} /></section>
<section id="related">{relatedBuildings.map((item) => <Link key={item.id} href={`/buildings/${item.slug}`}>{item.name}</Link>)}</section>
<InquiryModal pageType="building" targetBuildingSlug={building.slug} />
```

移动端供给固定使用卡片；桌面允许表格/卡片切换。`ListingCard` 增加可选 `variant="building-supply"`，仍只消费 DTO。

- [ ] **Step 4: 验证同一 asOf**

在页面加入仅供测试的 `data-supply-as-of={supply.asOf}`，E2E 断言聚合和列表容器属性相同；生产不展示该值。

- [ ] **Step 5: 提交**

```bash
git add 'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  payload-office-platform/src/components/frontend/ListingCard.tsx \
  payload-office-platform/tests/building-supply.test.ts \
  payload-office-platform/tests/e2e/detail-pages.spec.ts
git commit -m "feat: add grouped supply to building details"
```

---

### Task 8: 完成 SEO、分享和分析事件

**Files:**
- Create: `payload-office-platform/src/lib/frontend/detail-metadata.ts`
- Modify: `payload-office-platform/src/lib/frontend/analytics/events.ts`
- Modify: `payload-office-platform/src/components/frontend/DetailGallery.tsx`
- Modify: `payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Test: `payload-office-platform/tests/detail-pages-seo.test.ts`
- Test: `payload-office-platform/tests/analytics-events.test.ts`

**Interfaces:**
- Produces: `buildListingMetadata`, `buildBuildingMetadata`, `buildListingJsonLd`, `buildBuildingJsonLd`.
- Produces analytics names from FP-03 §15 and FP-04 §15 without PII.

- [ ] **Step 1: 写 SEO 和隐私失败测试**

```ts
it('无可信价格时 Product 不输出 offers', () => {
  const jsonLd = buildListingJsonLd(LISTING_PRICE_ON_REQUEST, ORIGIN)
  expect(jsonLd).not.toHaveProperty('offers')
})

it('楼盘 AggregateOffer 按完整价格 key 分组', () => {
  const jsonLd = buildBuildingJsonLd(BUILDING, MIXED_SUPPLY, ORIGIN)
  expect(jsonLd.offers).toHaveLength(2)
})

it('分析属性拒绝 PII key', () => {
  expect(() => assertSafeAnalyticsProps({ phone: '13800001111' })).toThrow()
})
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test -- tests/detail-pages-seo.test.ts tests/analytics-events.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现纯 metadata/JSON-LD 构建器**

所有 JSON-LD 最终序列化继续使用：

```ts
JSON.stringify(value).replace(/</g, '\\u003c')
```

房源使用 `Product + Offer`，楼盘使用 `Place + AggregateOffer[]`，两页均输出 `BreadcrumbList`。不输出 rating、经纪人、未经验证 availability。

- [ ] **Step 4: 接入匿名事件**

事件属性只包含 ID、枚举、结果数、排名、section、`asOf` 和信息完整度。Gallery、供给筛选、推荐、咨询分别使用现有 `track()`。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/detail-pages-seo.test.ts tests/analytics-events.test.ts
pnpm typecheck
```

Expected: PASS。

```bash
git add payload-office-platform/src/lib/frontend/detail-metadata.ts \
  payload-office-platform/src/lib/frontend/analytics/events.ts \
  payload-office-platform/src/components/frontend/DetailGallery.tsx \
  payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx \
  'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  payload-office-platform/tests/detail-pages-seo.test.ts \
  payload-office-platform/tests/analytics-events.test.ts
git commit -m "feat: add detail SEO and privacy-safe analytics"
```

---

### Task 9: 完成详情视觉、响应式和可访问性

**Files:**
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Modify: `payload-office-platform/src/components/frontend/DetailGallery.tsx`
- Modify: `payload-office-platform/src/components/frontend/DetailAnchorNav.tsx`
- Modify: `payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx`
- Test: `payload-office-platform/tests/e2e/detail-pages.spec.ts`
- Test: `payload-office-platform/tests/e2e/f7-3-accessibility.spec.ts`

**Interfaces:**
- Consumes: existing design tokens `--ink --muted --line --paper --cream --gold --deep --green`.
- Produces: 12 栏桌面、单列平板、移动固定 CTA、44px 触控目标。

- [ ] **Step 1: 写断点和键盘 E2E**

```ts
for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`房源详情 ${viewport.width}px 无横向溢出`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/listings/jingan-center-100-monthly')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })
}
```

- [ ] **Step 2: 运行并确认红灯**

```bash
pnpm test:e2e -- tests/e2e/detail-pages.spec.ts tests/e2e/f7-3-accessibility.spec.ts
```

Expected: 新断点或键盘断言 FAIL。

- [ ] **Step 3: 实现 CSS**

核心规则：

```css
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(320px, 5fr);
  gap: clamp(24px, 3vw, 48px);
}

.detail-mobile-bar { display: none; }

@media (max-width: 1199px) {
  .detail-hero { grid-template-columns: 1fr; }
}

@media (max-width: 767px) {
  .detail-page { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
  .detail-mobile-bar {
    display: flex;
    min-height: 64px;
    padding-bottom: env(safe-area-inset-bottom);
  }
}

@media (prefers-reduced-motion: reduce) {
  .detail-page * { scroll-behavior: auto; transition-duration: 0.01ms; }
}
```

- [ ] **Step 4: 验证焦点和语义**

E2E 覆盖 Gallery Esc/左右键、Tab 切换、咨询焦点归还、错误焦点、颜色非唯一状态。

- [ ] **Step 5: 提交**

```bash
git add 'payload-office-platform/src/app/(frontend)/styles.css' \
  payload-office-platform/src/components/frontend/DetailGallery.tsx \
  payload-office-platform/src/components/frontend/DetailAnchorNav.tsx \
  payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx \
  payload-office-platform/tests/e2e/detail-pages.spec.ts \
  payload-office-platform/tests/e2e/f7-3-accessibility.spec.ts
git commit -m "feat: complete responsive detail page UX"
```

---

### Task 10: 全量验证、迁移证据和任务收口

**Files:**
- Modify: `specs/work-items/FPD-P0-detail-pages-core.md`
- Create: `artifacts/verification/FPD-P0/README.md`
- Create: `artifacts/verification/FPD-P0/migration-dry-run.txt`
- Create: `artifacts/verification/FPD-P0/browser-matrix.md`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: 可审计的 P0 完成证据；不更改业务接口。

- [ ] **Step 1: 在独立 PostgreSQL 执行迁移验证**

```bash
pnpm migrate:dry-run
pnpm migrate:verify
pnpm migrate:status
```

Expected: dry-run 无破坏性删除；verify PASS；新迁移从 pending 变为 applied。将完整输出保存到 `migration-dry-run.txt`。

- [ ] **Step 2: 执行静态和自动化门禁**

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm typecheck
pnpm lint
pnpm test
NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build
```

Expected: 全部 exit 0。

- [ ] **Step 3: 执行浏览器矩阵**

```bash
pnpm test:e2e -- tests/e2e/detail-pages.spec.ts \
  tests/e2e/inquiry-flow.spec.ts \
  tests/e2e/disabled-supply-not-reachable.spec.ts \
  tests/e2e/f7-3-accessibility.spec.ts
```

Expected: PASS。人工补充验证 `/listings/[slug]`、`/buildings/[slug]`、相邻 `/listings` 和浏览器控制台。

- [ ] **Step 4: 写证据和剩余风险**

`README.md` 必须记录：提交 SHA、数据库名（不含密码）、命令、结果、四档视口、失效/无供给/价格面议/跨单位/咨询降级结果、未验证项。

- [ ] **Step 5: 提交收口证据**

```bash
git add specs/work-items/FPD-P0-detail-pages-core.md \
  artifacts/verification/FPD-P0
git commit -m "test: verify detail pages P0"
```

---

## P0 Definition of Done

- 两个页面只消费公开 DTO，现有有效供给不变量没有降级。
- 房源事实、楼盘事实和楼盘聚合不存在跨层混用。
- 楼内供给按出租、出售、联合办公及完整价格 key 分组。
- 房源失效提交能降级到有效楼盘或通用需求，不建立错误关系。
- metadata、JSON-LD、sitemap 和页面可见性一致。
- 375/768/1440/1920 四档视口、键盘、失效、空供给、图片失败和价格面议均有证据。
- PostgreSQL 迁移、类型、lint、全量测试、构建和目标 E2E 全绿。

## Cross-Plan PRD Traceability

| PRD 范围 | 实施计划 |
|---|---|
| FP-03 §1–7、§9–20 的 P0 能力 | 本计划 Tasks 1–10 |
| FP-04 §1–7、§9–21 的 P0 能力 | 本计划 Tasks 1–10 |
| 两页分类视频、平面图增强、地图/POI、收藏/分享增强、信息纠错 | `2026-07-30-detail-pages-p1-enhancements.md` |
| 两页路线规划、待确认预约、平台服务状态、可解释情境推荐 | `2026-07-30-detail-pages-p2-guidance.md` |
