# MP-103 小程序首页、搜索与房源列表实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付匿名用户可从小程序首页通过搜索或快捷筛选进入上海真实房源列表的首个可运行纵向闭环。

**Architecture:** 原生微信小程序保持页面轻编排，运行时 DTO 校验、查询序列化、展示格式化和空态退路分别放在可独立测试的纯 TypeScript 模块中。首页与列表只调用 `/api/mini/v1/home` 和 `/api/mini/v1/listings`，不接触 Payload 文档；计价单位作为结果集维度，价格区间永远与单位共同提交。

**Tech Stack:** 原生微信小程序、TypeScript 5.9、WXML/WXSS、Vitest 4、miniprogram-simulate 1.6、现有 Mini API v1。

## Global Constraints

- 页面底色 `#f2f2f4`，白卡圆角 8px，图片/输入/按钮圆角 6px，标签圆角 3px。
- 触控目标不小于 44×44px，相邻操作间距不小于 8px；中文使用系统字体，数字使用 `.num` 与等宽数字。
- 首页短品牌区高度 160–180px，搜索和真实房源优先于品牌长叙事。
- 房源卡采用左图右文；不显示商户名与“今天更新”，价格不用装饰性色。
- 月租估算是主价格；原始单位报价为次信息。缺少月租估算时不得伪造，回退显示原始报价或“价格面议”。
- `priceUnit` 是结果集维度。没有 `priceUnit` 时不得提交 `priceMin`/`priceMax`，不得跨单位换算、聚合或价格排序。
- 首页与列表默认城市固定为 `shanghai`；城市切换不在 MP-103 范围。
- 页面必须覆盖首屏骨架、刷新、空结果、服务错误、图片失败和旧数据刷新失败状态。
- 首版筛选只呈现当前 API 有可靠数据或确定输入方式的维度：关键词、区域、类型、面积、价格、计价单位、最晚入驻时间。商圈与地铁候选项等待 API 契约扩展。
- 不实现地图、对比、收藏、求租广场、详情内容或咨询写入；房源点击只导航到 MP-104 预留详情路由，不创建假详情页。
- 不提交 `project.private.config.json`、AppID、AppSecret、上传私钥、数据库配置或预览二维码。

---

### Task 1: Mini API 运行时契约与目录服务

**Files:**
- Create: `sbh-miniprogram/miniprogram/services/catalog-contracts.ts`
- Create: `sbh-miniprogram/miniprogram/services/catalog.ts`
- Test: `sbh-miniprogram/tests/catalog-contracts.test.ts`
- Test: `sbh-miniprogram/tests/catalog-service.test.ts`

**Interfaces:**
- Consumes: `request<T>(options)` from `miniprogram/services/request.ts`。
- Produces: `parseMiniHomeData(value)`, `parseMiniListingsData(value)`, `getHome(city)`, `getListings(query)`；后续页面只消费这些接口。

- [ ] **Step 1: 为合法首页、列表 DTO 与畸形字段编写失败测试**

```ts
it('拒绝把缺少分页或价格单位不合法的列表 DTO 交给页面', () => {
  expect(() => parseMiniListingsData({ items: [], filters: [] })).toThrow()
  expect(() => parseMiniListingsData({
    ...validListings,
    currentPriceUnit: 'rmb-unknown',
  })).toThrow()
})
```

- [ ] **Step 2: 运行契约测试并确认因 parser 尚不存在而失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/catalog-contracts.test.ts`

Expected: FAIL，错误指向 `catalog-contracts.ts` 或导出不存在。

- [ ] **Step 3: 实现封闭 DTO 类型和逐字段运行时校验**

```ts
export type PriceDisplayUnit =
  | 'rmb-sqm-day' | 'rmb-sqm-month' | 'rmb-sqm-year' | 'rmb-sqm-total'
  | 'rmb-seat-day' | 'rmb-seat-month' | 'rmb-seat-year' | 'rmb-seat-total'
  | 'rmb-day' | 'rmb-month' | 'rmb-year' | 'rmb-total'

export function parseMiniListingsData(value: unknown): MiniListingsData {
  const record = requireRecord(value)
  return {
    items: requireArray(record.items, parseMiniListingCard),
    pagination: parsePagination(record.pagination),
    canonicalQuery: requireString(record.canonicalQuery),
    currentPriceUnit: optionalPriceUnit(record.currentPriceUnit),
    filters: requireArray(record.filters, parseMiniQuickFilter),
  }
}
```

校验必须覆盖嵌套图片、楼盘、价格、筛选计数、固定 `pageSize: 24`、非负分页数字和 `currentPriceUnit` 白名单；异常信息不得包含原始响应内容。

- [ ] **Step 4: 运行契约测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/catalog-contracts.test.ts`

Expected: PASS，合法 DTO 被保留，畸形 DTO 被拒绝。

- [ ] **Step 5: 为目录服务路径编码和城市固定参数编写失败测试**

```ts
it('列表请求使用规范化查询且不允许覆盖城市', async () => {
  await catalog.getListings('district=jingan&page=2')
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    path: '/api/mini/v1/listings?city=shanghai&district=jingan&page=2',
    parse: parseMiniListingsData,
  }))
})
```

- [ ] **Step 6: 运行目录服务测试并确认因实现缺失而失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/catalog-service.test.ts`

Expected: FAIL，`createCatalogService` 不存在。

- [ ] **Step 7: 实现可注入 request 的目录服务**

```ts
export function createCatalogService(requestClient = request) {
  return {
    getHome(city = 'shanghai') {
      return requestClient({
        path: `/api/mini/v1/home?city=${encodeURIComponent(city)}`,
        parse: parseMiniHomeData,
      })
    },
    getListings(query = '') {
      const suffix = query ? `&${query}` : ''
      return requestClient({
        path: `/api/mini/v1/listings?city=shanghai${suffix}`,
        parse: parseMiniListingsData,
      })
    },
  }
}
```

实现需通过共享查询序列化器生成 `query`，不得直接拼接未编码用户输入；示例只锁定最终接口形态。

- [ ] **Step 8: 运行目录服务与现有请求层测试**

Run: `cd sbh-miniprogram && pnpm test -- tests/catalog-service.test.ts tests/request.test.ts`

Expected: PASS，现有重试和错误分类测试无回归。

---

### Task 2: URL 等价筛选状态、分页与放宽建议

**Files:**
- Create: `sbh-miniprogram/miniprogram/domain/listing-query.ts`
- Create: `sbh-miniprogram/miniprogram/domain/relaxations.ts`
- Test: `sbh-miniprogram/tests/listing-query.test.ts`
- Test: `sbh-miniprogram/tests/relaxations.test.ts`

**Interfaces:**
- Consumes: `MiniListingsData.pagination.totalDocs` from Task 1。
- Produces: `parseListingQuery`, `serializeListingQuery`, `applyListingPatch`, `nextPageQuery`, `buildRelaxationQueries`, `loadRelaxations`。

- [ ] **Step 1: 为规范化、确定性字段顺序和页码归一编写失败测试**

```ts
it('改变结果集时删除 page，只有翻页动作保留 page', () => {
  const current = parseListingQuery('district=jingan&priceUnit=rmb-month&page=3')
  expect(serializeListingQuery(applyListingPatch(current, { areaMin: 300 })))
    .toBe('district=jingan&areaMin=300&priceUnit=rmb-month')
  expect(serializeListingQuery(nextPageQuery(current, 4)))
    .toBe('district=jingan&priceUnit=rmb-month&page=4')
})
```

同时测试重复数组去重、空白关键词删除、倒置区间删除整段、无单位时价格区间删除、价格排序无单位时降级为 `recommended`、非法枚举和数值静默丢弃。

- [ ] **Step 2: 运行查询测试并确认失败原因是实现缺失**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-query.test.ts`

Expected: FAIL，查询函数未定义。

- [ ] **Step 3: 实现不可变查询状态与固定顺序序列化**

```ts
export interface ListingQuery {
  q?: string
  district?: readonly string[]
  type?: readonly ListingType[]
  areaMin?: number
  areaMax?: number
  priceMin?: number
  priceMax?: number
  priceUnit?: PriceDisplayUnit
  availableBefore?: string
  sort: ListingSort
  page: number
}

const RESULT_DIMENSIONS = new Set([
  'q', 'district', 'type', 'areaMin', 'areaMax',
  'priceMin', 'priceMax', 'priceUnit', 'availableBefore', 'sort',
])
```

`applyListingPatch` 只要变更 `RESULT_DIMENSIONS` 内任一字段，就把 `page` 归一为 1；序列化顺序固定为 `q → district → type → areaMin → areaMax → priceMin → priceMax → priceUnit → availableBefore → sort → page`。

- [ ] **Step 4: 运行查询测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-query.test.ts`

Expected: PASS。

- [ ] **Step 5: 为零结果逐项放宽和最多三次真实计数请求编写失败测试**

```ts
it('只给收窄条件生成最多三条放宽查询并保留计价单位', async () => {
  const query = parseListingQuery('q=江景&district=jingan&areaMin=500&priceUnit=rmb-sqm-day')
  const suggestions = await loadRelaxations(query, getListings)
  expect(suggestions).toHaveLength(3)
  expect(suggestions.every((item) => item.query.includes('priceUnit=rmb-sqm-day'))).toBe(true)
})
```

- [ ] **Step 6: 运行放宽测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/relaxations.test.ts`

Expected: FAIL，放宽函数未定义。

- [ ] **Step 7: 实现关键词、区域、面积、价格、入驻时间的放宽候选**

```ts
export async function loadRelaxations(
  query: ListingQuery,
  getListings: (query: string) => Promise<MiniListingsData>,
): Promise<readonly RelaxationSuggestion[]> {
  const candidates = buildRelaxationQueries(query).slice(0, 3)
  const settled = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      ...candidate,
      count: (await getListings(candidate.query)).pagination.totalDocs,
    })),
  )
  return settled.flatMap((result) =>
    result.status === 'fulfilled' && result.value.count > 0 ? [result.value] : [],
  )
}
```

单条计数失败不得覆盖列表主空态；“清除全部条件”始终保留当前计价单位，避免清除动作悄悄切换结果集。

- [ ] **Step 8: 运行 Task 2 全部测试**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-query.test.ts tests/relaxations.test.ts`

Expected: PASS。

---

### Task 3: 房源展示模型与左图右文卡片

**Files:**
- Create: `sbh-miniprogram/miniprogram/domain/listing-presentation.ts`
- Create: `sbh-miniprogram/miniprogram/components/listing-card/index.ts`
- Create: `sbh-miniprogram/miniprogram/components/listing-card/index.json`
- Create: `sbh-miniprogram/miniprogram/components/listing-card/index.wxml`
- Create: `sbh-miniprogram/miniprogram/components/listing-card/index.wxss`
- Test: `sbh-miniprogram/tests/listing-presentation.test.ts`
- Test: `sbh-miniprogram/tests/listing-card.test.ts`

**Interfaces:**
- Consumes: `MiniListingCard` from Task 1。
- Produces: `presentListingCard(card)` and `<listing-card listing="{{item}}" bindopen="..." />`。

- [ ] **Step 1: 为月租、回退价格、元信息和缺图编写失败测试**

```ts
it('优先显示月租估算并把原始报价降为次信息', () => {
  expect(presentListingCard(cardWithMonthlyEstimate)).toMatchObject({
    primaryPrice: '约 ¥36,500/月',
    secondaryPrice: '4.5 元/㎡/天',
  })
})

it('缺少估算时不伪造月租', () => {
  expect(presentListingCard(cardWithoutPrice).primaryPrice).toBe('价格面议')
})
```

- [ ] **Step 2: 运行展示模型测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-presentation.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现纯展示映射与中文数字格式**

```ts
export function presentListingCard(card: MiniListingCard): ListingCardPresentation {
  const monthly = card.price?.monthlyEstimate
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    imageUrl: card.coverImage?.src ?? '',
    imageAlt: card.coverImage?.alt || card.title,
    primaryPrice: monthly == null ? card.price?.text ?? '价格面议' : `约 ¥${formatInteger(monthly)}/月`,
    secondaryPrice: monthly == null ? '' : card.price?.text ?? '',
    facts: compactFacts(card),
    location: compactLocation(card),
    tags: card.highlights.slice(0, 3),
  }
}
```

金额只按 API 提供的 `monthlyEstimate` 展示；不得在客户端自行推算。

- [ ] **Step 4: 运行展示模型测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-presentation.test.ts`

Expected: PASS。

- [ ] **Step 5: 为卡片结构、按压、图片失败和 open 事件编写失败组件测试**

```ts
it('图片失败后显示文字占位，点击仍携带 slug', async () => {
  image.dispatchEvent('error')
  card.dispatchEvent('tap')
  await simulate.sleep(0)
  expect(subject.data.imageFailed).toBe(true)
  expect(host.data.openedSlug).toBe('jing-an-center-101')
})
```

- [ ] **Step 6: 运行组件测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-card.test.ts`

Expected: FAIL。

- [ ] **Step 7: 实现单层卡片、112×84 比例图片、两行标题和零色相标签**

```xml
<view class="listing-card" hover-class="listing-card--pressed" hover-stay-time="70" bindtap="handleOpen">
  <view class="listing-card__media">
    <image wx:if="{{listing.imageUrl && !imageFailed}}" src="{{listing.imageUrl}}" mode="aspectFill" binderror="handleImageError" />
    <view wx:else class="listing-card__placeholder">暂无图片</view>
  </view>
  <view class="listing-card__body">
    <view class="listing-card__title">{{listing.title}}</view>
    <view class="listing-card__facts num">{{listing.facts}}</view>
    <view class="listing-card__location">{{listing.location}}</view>
    <view class="listing-card__price num">{{listing.primaryPrice}}</view>
    <view wx:if="{{listing.secondaryPrice}}" class="listing-card__quote num">{{listing.secondaryPrice}}</view>
  </view>
</view>
```

- [ ] **Step 8: 运行 Task 3 测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/listing-presentation.test.ts tests/listing-card.test.ts`

Expected: PASS。

---

### Task 4: 吸顶筛选行与半屏筛选面板

**Files:**
- Create: `sbh-miniprogram/miniprogram/components/filter-bar/index.ts`
- Create: `sbh-miniprogram/miniprogram/components/filter-bar/index.json`
- Create: `sbh-miniprogram/miniprogram/components/filter-bar/index.wxml`
- Create: `sbh-miniprogram/miniprogram/components/filter-bar/index.wxss`
- Create: `sbh-miniprogram/miniprogram/components/filter-sheet/index.ts`
- Create: `sbh-miniprogram/miniprogram/components/filter-sheet/index.json`
- Create: `sbh-miniprogram/miniprogram/components/filter-sheet/index.wxml`
- Create: `sbh-miniprogram/miniprogram/components/filter-sheet/index.wxss`
- Test: `sbh-miniprogram/tests/filter-components.test.ts`

**Interfaces:**
- Consumes: `ListingQuery`, `MiniQuickFilter[]`, and `resultCount`。
- Produces: `open`, `apply`, `clear`, `close` component events；页面持有已应用状态，sheet 只持有暂存状态。

- [ ] **Step 1: 为 44px 触达、单位优先、暂存取消和实时数量编写失败测试**

```ts
it('打开价格面板时先呈现计价单位，取消不污染已应用状态', async () => {
  expect(subject.querySelector('.filter-sheet__unit')).toBeDefined()
  choosePriceUnit('rmb-month')
  cancel.dispatchEvent('tap')
  await simulate.sleep(0)
  expect(host.data.appliedQuery).toEqual(originalQuery)
})
```

- [ ] **Step 2: 运行筛选组件测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/filter-components.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现吸顶四入口筛选行**

```xml
<view class="filter-bar">
  <button class="filter-bar__item" data-section="location" bindtap="handleOpen">位置</button>
  <button class="filter-bar__item" data-section="price" bindtap="handleOpen">价格</button>
  <button class="filter-bar__item" data-section="area" bindtap="handleOpen">面积</button>
  <button class="filter-bar__item" data-section="all" bindtap="handleOpen">筛选<text wx:if="{{activeCount}}">({{activeCount}})</text></button>
</view>
```

每个入口实际高度 88rpx；激活态通过背景和字重，不依赖颜色。

- [ ] **Step 4: 实现带安全区的半屏面板与暂存状态**

```ts
Component({
  properties: { open: Boolean, query: Object, filters: Array, resultCount: Number, estimating: Boolean },
  data: { draft: {} },
  observers: {
    'open, query'(open, query) {
      if (open) this.setData({ draft: cloneListingQuery(query) })
    },
  },
  methods: {
    handleDraftChange(event) {
      const draft = applyListingPatch(this.data.draft, event.currentTarget.dataset.patch)
      this.setData({ draft })
      this.triggerEvent('estimate', { query: draft })
    },
    handleApply() { this.triggerEvent('apply', { query: this.data.draft }) },
    handleClose() { this.triggerEvent('close') },
  },
})
```

计价单位区必须排在价格上下限前；结果按钮文案为“查看 N 套”，估算中显示“正在计算”；价格单位变更时清空原价格区间。

- [ ] **Step 5: 运行筛选组件测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/filter-components.test.ts`

Expected: PASS。

---

### Task 5: 首页任务入口与精选房源

**Files:**
- Create: `sbh-miniprogram/miniprogram/pages/home/index.ts`
- Create: `sbh-miniprogram/miniprogram/pages/home/index.json`
- Create: `sbh-miniprogram/miniprogram/pages/home/index.wxml`
- Create: `sbh-miniprogram/miniprogram/pages/home/index.wxss`
- Create: `sbh-miniprogram/miniprogram/pages/home/model.ts`
- Test: `sbh-miniprogram/tests/home-page-model.test.ts`
- Test: `sbh-miniprogram/tests/home-page-contract.test.ts`

**Interfaces:**
- Consumes: `catalog.getHome`, `presentListingCard`, `serializeListingQuery`。
- Produces: 首页加载状态、搜索提交、快捷筛选导航、精选卡导航和下拉刷新。

- [ ] **Step 1: 为首页加载状态、快捷筛选和搜索导航编写失败测试**

```ts
it('首页成功数据把真实计数投影为快捷筛选并展示首组房源', () => {
  const model = presentHome(validHome)
  expect(model.quickFilters[0]).toMatchObject({ label: '静安', count: 12 })
  expect(model.featuredListings.length).toBeGreaterThan(0)
})

it('搜索提交生成 q 查询并进入找房页', () => {
  expect(buildSearchNavigation(' 南京西路 ')).toBe('/pages/listings/index?q=%E5%8D%97%E4%BA%AC%E8%A5%BF%E8%B7%AF')
})
```

- [ ] **Step 2: 运行首页测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/home-page-model.test.ts tests/home-page-contract.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现首页展示模型与导航构造器**

```ts
export function buildSearchNavigation(keyword: string): string {
  const query = applyListingPatch(emptyListingQuery(), { q: keyword })
  const serialized = serializeListingQuery(query)
  return serialized ? `/pages/listings/index?${serialized}` : '/pages/listings/index'
}
```

快捷筛选每组只显示 API 返回且 `count > 0` 的前 4 项；点击时只设置该维度并进入列表。

- [ ] **Step 4: 实现页面加载、旧数据刷新失败和下拉刷新**

```ts
async loadHome(refresh = false) {
  if (!refresh && !this.data.content) this.setData({ state: 'loading' })
  try {
    const content = presentHome(await catalog.getHome('shanghai'))
    this.setData({ state: 'ready', content, refreshError: false })
  } catch {
    this.setData(this.data.content
      ? { state: 'ready', refreshError: true }
      : { state: 'error' })
  } finally {
    if (refresh) wx.stopPullDownRefresh()
  }
}
```

WXML 首屏顺序固定为：短品牌区 → 搜索 → 快捷筛选 → 精选房源；品牌说明不得把第一张真实房源挤出首屏下沿。

- [ ] **Step 5: 运行首页测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/home-page-model.test.ts tests/home-page-contract.test.ts`

Expected: PASS。

---

### Task 6: 房源列表、实时估算、分页与全状态

**Files:**
- Create: `sbh-miniprogram/miniprogram/pages/listings/index.ts`
- Create: `sbh-miniprogram/miniprogram/pages/listings/index.json`
- Create: `sbh-miniprogram/miniprogram/pages/listings/index.wxml`
- Create: `sbh-miniprogram/miniprogram/pages/listings/index.wxss`
- Create: `sbh-miniprogram/miniprogram/pages/listings/controller.ts`
- Test: `sbh-miniprogram/tests/listings-controller.test.ts`
- Test: `sbh-miniprogram/tests/listings-page-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 services, query functions and components。
- Produces: 可恢复的列表页控制器；`load`, `refresh`, `applyFilters`, `estimateDraft`, `loadNextPage`, `applyRelaxation`。

- [ ] **Step 1: 为首载、刷新保留旧数据、竞态和分页去重编写失败测试**

```ts
it('较旧请求后返回时不能覆盖较新的筛选结果', async () => {
  const first = deferred<MiniListingsData>()
  const second = deferred<MiniListingsData>()
  const controller = createListingsController({ getListings: vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise) })
  void controller.load(parseListingQuery('district=jingan'))
  void controller.load(parseListingQuery('district=xuhui'))
  second.resolve(xuhuiResult)
  first.resolve(jinganResult)
  await flushPromises()
  expect(controller.snapshot().items).toEqual(xuhuiResult.items)
})
```

同时测试：首载骨架、错误重试、下拉刷新失败保留旧卡、`hasNextPage=false` 不请求、下一页按 `id` 去重、筛选变化替换列表、零结果加载放宽数量。

- [ ] **Step 2: 运行控制器测试并确认失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/listings-controller.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现请求序号守卫和页面状态机**

```ts
export type ListingsLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export function createListingsController(dependencies: ListingsDependencies) {
  let requestVersion = 0
  let snapshot: ListingsSnapshot = initialListingsSnapshot()

  async function load(query: ListingQuery, mode: 'replace' | 'append' = 'replace') {
    const version = ++requestVersion
    snapshot = beginLoad(snapshot, mode)
    notify(snapshot)
    try {
      const result = await dependencies.getListings(serializeListingQuery(query))
      if (version !== requestVersion) return
      snapshot = receiveListings(snapshot, query, result, mode)
      notify(snapshot)
    } catch (error) {
      if (version !== requestVersion) return
      snapshot = receiveListingsError(snapshot, error, mode)
      notify(snapshot)
    }
  }

  return { load, snapshot: () => snapshot, dispose: () => { requestVersion += 1 } }
}
```

- [ ] **Step 4: 实现 250ms 暂存条件估算防抖**

估算只读取 `pagination.totalDocs`；新估算启动后旧响应不得覆盖；关闭筛选面板必须取消定时器并使在途响应失效。

```ts
function estimateDraft(query: ListingQuery) {
  clearTimeout(estimateTimer)
  estimateTimer = setTimeout(() => runEstimate(query), 250)
}
```

- [ ] **Step 5: 运行控制器测试并确认通过**

Run: `cd sbh-miniprogram && pnpm test -- tests/listings-controller.test.ts`

Expected: PASS。

- [ ] **Step 6: 为列表 WXML 状态与交互编写失败合同测试**

```ts
it('列表包含骨架、错误、空结果退路、图片卡和触底入口', () => {
  expect(markup).toContain('id="listings-ready"')
  expect(markup).toContain('<filter-bar')
  expect(markup).toContain('<filter-sheet')
  expect(markup).toContain('<listing-card')
  expect(markup).toContain('逐项放宽')
})
```

- [ ] **Step 7: 实现列表页面编排与 WXML/WXSS**

页面 `onLoad(options)` 只从白名单键构造查询；加载成功后用 API 返回的 `canonicalQuery` 回写本地规范状态。`onReachBottom` 仅在 `ready && hasNextPage && !loadingMore` 时加载下一页；下拉刷新使用当前规范查询替换数据。

空态必须按顺序展示：零结果说明 → 有真实数量的逐项放宽建议 → “清除全部条件” → MP-104 前仅展示不可交互的“顾问找房功能即将开放”说明，不创建假咨询按钮。

- [ ] **Step 8: 运行列表合同与组件测试**

Run: `cd sbh-miniprogram && pnpm test -- tests/listings-controller.test.ts tests/listings-page-contract.test.ts tests/filter-components.test.ts tests/listing-card.test.ts`

Expected: PASS。

---

### Task 7: 应用路由、自动化入口、文档与验收

**Files:**
- Modify: `sbh-miniprogram/miniprogram/app.json`
- Modify: `sbh-miniprogram/scripts/check-project.mjs`
- Modify: `sbh-miniprogram/scripts/devtools-smoke.mjs`
- Modify: `sbh-miniprogram/README.md`
- Create: `artifacts/verification/MP-103/README.md`
- Modify: `specs/work-items/MP-002-miniprogram-delivery-roadmap.md`
- Test: `sbh-miniprogram/tests/project-contract.test.ts`
- Test: `sbh-miniprogram/tests/tooling-scripts.test.ts`

**Interfaces:**
- Consumes: 首页 `#home-ready` 与列表 `#listings-ready` 就绪标记。
- Produces: 首页为首路由、首页/找房两项 tabBar、可重复执行的开发者工具冒烟路径和验收记录。

- [x] **Step 1: 先修改工程合同测试，要求首页为首路由且无死页面 tab**

```ts
expect(appConfig.pages[0]).toBe('pages/home/index')
expect(appConfig.pages).toContain('pages/listings/index')
expect(appConfig.tabBar.list.map((item) => item.pagePath)).toEqual([
  'pages/home/index',
  'pages/listings/index',
])
```

MP-105/MP-106 加入楼盘和“我的”后再扩成最终四项；MP-103 不建立空白占位 tab。

- [x] **Step 2: 运行工程合同测试并确认它因 foundation 仍是首路由而失败**

Run: `cd sbh-miniprogram && pnpm test -- tests/project-contract.test.ts`

Expected: FAIL，实际首路由仍为 `pages/foundation/index`。

- [x] **Step 3: 更新 app.json、工程检查和自动化目标**

```json
{
  "pages": [
    "pages/home/index",
    "pages/listings/index",
    "pages/foundation/index"
  ],
  "tabBar": {
    "color": "#6e6e73",
    "selectedColor": "#1d1d1f",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/home/index", "text": "首页" },
      { "pagePath": "pages/listings/index", "text": "找房" }
    ]
  }
}
```

自动化先 `reLaunch('/pages/home/index')` 并等待 `#home-ready`，再 `switchTab('/pages/listings/index')` 等待 `#listings-ready`；两页验收窗口内的任意运行时异常都视为失败。

- [x] **Step 4: 运行工程合同和工具脚本测试**

Run: `cd sbh-miniprogram && pnpm test -- tests/project-contract.test.ts tests/tooling-scripts.test.ts`

Expected: PASS。

- [x] **Step 5: 更新 README、MP-002 状态和 MP-103 证据模板**

证据文件必须分开记录：Node 自动化、微信开发者工具模拟器、真机、合法域名和图片域名。未执行项写“未执行 + 原因”，不得用 Node 测试替代。

- [ ] **Step 6: 运行小程序完整质量门**

Run: `cd sbh-miniprogram && pnpm test && pnpm typecheck && pnpm project:check && pnpm audit --audit-level high`

Expected: 所有测试通过，两个 TypeScript 项目通过，工程检查通过，无 high/critical 漏洞。

2026-08-27 实施记录：全量测试 19 文件、241/241 通过，两个 TypeScript 项目与 `project:check` 通过；但全量开发依赖审计为 27 high / 7 critical，因此本步不勾选。`--prod` 审计为 0，但不代替全量门禁。

- [x] **Step 7: 运行 Web 回归质量门**

Run: `cd payload-office-platform && pnpm typecheck && pnpm test`

Expected: 类型检查和全量测试通过，Mini API 门面无回归。

- [ ] **Step 8: 在微信开发者工具条件允许时运行模拟器冒烟**

Run: `cd sbh-miniprogram && WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" pnpm devtools:smoke`

Expected: 首页和找房页均命中 ready 标记，验收窗口无运行时异常。若 IDE 服务端口仍关闭，证据记录为“未执行：IDE 服务端口关闭”，不得擅自开启。

2026-08-27 实施记录：按既定 CLI 路径尝试一次；未执行：IDE 服务端口关闭，未命中任一真实 ready marker，且未修改安全设置。初次尝试暴露的 CLI 失败后悬挂已通过真实 Node 子进程 TDD 关闭：失败入口经 250ms best-effort 清理宽限后以退出码 1 有界结束，成功入口不强制退出。

- [ ] **Step 9: 按验收矩阵进行视觉与弱网走查**

在模拟器和至少一台真机分别验证：初次进入、搜索、区域快捷筛选、计价单位切换、价格/面积筛选、空结果逐项放宽、错误重试、下拉刷新、触底分页、图片失败、安全区和 44px 触达。截图命名采用 `MP-103-<device>-<state>.png`，只存脱敏画面。

2026-08-27 实施记录：未执行；模拟器自动化端口不可用，且本轮无真机、真实 AppID 与微信账号验收会话。详见 `artifacts/verification/MP-103/README.md`。

- [x] **Step 10: 提交前核对范围与敏感文件**

Run: `git status --short && git diff --check && git diff --name-only --cached`

Expected: 不包含 `project.private.config.json`、AppID、密钥、二维码或用户原有 `docs/SBH小程序页面设计/` 未跟踪文件；仅显式暂存 MP-103 路径。

2026-08-27 实施记录：`git diff --check` 通过，索引为空（本轮不得暂存或提交）；未发现私有配置、AppID、密钥、二维码或预览产物。用户原有 `docs/SBH小程序页面设计/` 仍为未跟踪输入，Task 7 未修改。

---

## Self-Review

- Spec coverage：首页层级、搜索、真实快捷筛选、计价单位隔离、左图右文、月租优先、骨架/空/错/刷新/图片失败、分页、逐项放宽与模拟器/真机证据均有任务覆盖。
- Scope boundary：没有地图、收藏、详情内容、咨询写入、楼盘和“我的”占位页；最终四 tab 信息架构保留给 MP-105/MP-106。
- API truthfulness：区域、类型、计价单位使用 API 真实 facet；面积/价格/关键词/日期通过真实列表查询得到总量；商圈和地铁不伪造候选项。
- Type consistency：页面统一消费 `MiniHomeData`、`MiniListingsData`、`ListingQuery`、`ListingCardPresentation`；查询字符串只由 `serializeListingQuery` 生成。
- Security：客户端不持有 AppSecret，不直连数据库，不提交正式 AppID、私钥或预览产物。
