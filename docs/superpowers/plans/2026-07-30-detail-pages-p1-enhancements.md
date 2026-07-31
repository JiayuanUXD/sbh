# 房源与楼盘详情 P1 地图、媒体与纠错实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0 详情页基础上增加分类视频/平面图、高德地图与周边 POI、分享/本地收藏和可审计信息纠错，同时保证第三方失败不影响供给和咨询。

**Architecture:** 高德地图服务通过 `domain/location-services` 的 provider 接口隔离；服务端 WebService Key 只用于 POI 查询，浏览器 JS Key 只用于地图渲染并配置域名白名单。媒体仍由 Public Catalog DTO 供应，纠错进入独立只追加记录和后台任务，收藏仅使用本地不可识别 ID。

**Tech Stack:** Next.js 16、React 19、Payload 3.86、高德地图 JS API / WebService API、PostgreSQL、Vitest、Playwright。

## Global Constraints

- 依赖完成并合并 `2026-07-30-detail-pages-p0-core.md`。
- 执行前创建独立 worktree `codex/detail-pages-p1-enhancements`、独立端口和独立 PostgreSQL 数据库。
- 高德地图服务为唯一地图/POI 真源；不得同时接入腾讯、百度或第二套人工 POI。
- 环境变量固定为 `NEXT_PUBLIC_AMAP_JS_KEY`（域名白名单浏览器 Key）和 `AMAP_WEB_SERVICE_KEY`（仅服务端）；任何 Key 不得提交。
- 用户未主动点击“查看到这里的路线”前不得请求定位；P1 不实现路线规划，只提供第三方地图打开链接。
- POI 不进入 JSON-LD；地图和视频均不进入首屏关键链路。
- 新 HTTP 入口 `/api/corrections` 必须具同源检查、schema、限流、幂等和隐私日志。
- 证据写入 `artifacts/verification/FPD-P1/README.md`，任务包写入 `specs/work-items/FPD-P1-detail-enhancements.md`。

---

## File Map

| 文件 | 单一职责 |
|---|---|
| `src/domain/location-services/contracts.ts` | 坐标、POI、provider 和错误类型 |
| `src/domain/location-services/amap-provider.ts` | 高德 WebService 响应白名单和请求 |
| `src/domain/location-services/cache.ts` | 楼盘/类别级 POI 缓存与时效 |
| `src/components/frontend/LocationPanel.tsx` | 延迟加载地图、分类列表和静态降级 |
| `src/components/frontend/AmapMapCanvas.tsx` | 浏览器地图和 marker 高亮 |
| `src/components/frontend/DetailGallery.tsx` | 视频/平面图分类及延迟播放器 |
| `src/domain/corrections/schema.ts` | 纠错请求白名单 |
| `src/collections/InformationCorrections.ts` | 只追加纠错事实 |
| `src/app/(frontend)/api/corrections/route.ts` | 纠错写入和任务发布 |
| `src/components/frontend/CorrectionModal.tsx` | 纠错入口和表单 |
| `src/components/frontend/ShareSaveActions.tsx` | canonical 分享和本地收藏 |

---

### Task 1: 建立 P1 任务包和位置服务契约

**Files:**
- Create: `specs/work-items/FPD-P1-detail-enhancements.md`
- Create: `payload-office-platform/src/domain/location-services/contracts.ts`
- Create: `payload-office-platform/src/domain/location-services/index.ts`
- Test: `payload-office-platform/tests/location-services-contract.test.ts`

**Interfaces:**
- Produces: `LocationProvider`, `NearbyPoi`, `PoiCategory`, `Coordinates`, `LocationServiceError`.
- Consumes: Building DTO 的公开近似坐标，不消费内部高精度坐标。

- [ ] **Step 1: 写失败测试**

```ts
it('POI 类别只允许四类', () => {
  expect(parsePoiCategory('transport')).toBe('transport')
  expect(parsePoiCategory('hospital')).toBeNull()
})

it('坐标超界被拒绝', () => {
  expect(parseCoordinates({ latitude: 91, longitude: 121 })).toBeNull()
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/location-services-contract.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现契约**

```ts
export const POI_CATEGORIES = ['transport', 'restaurant', 'bank', 'hotel'] as const
export type PoiCategory = (typeof POI_CATEGORIES)[number]

export type Coordinates = Readonly<{ latitude: number; longitude: number }>
export type NearbyPoi = Readonly<{
  id: string
  category: PoiCategory
  name: string
  coordinates: Coordinates
  distanceMeters: number
  direction: string | null
  source: 'amap-location-service'
  fetchedAt: string
}>

export interface LocationProvider {
  nearby(input: Readonly<{
    center: Coordinates
    category: PoiCategory
    limit: 5
  }>): Promise<readonly NearbyPoi[]>
}
```

- [ ] **Step 4: 跑绿并提交**

```bash
pnpm test -- tests/location-services-contract.test.ts
pnpm typecheck
git add specs/work-items/FPD-P1-detail-enhancements.md \
  payload-office-platform/src/domain/location-services \
  payload-office-platform/tests/location-services-contract.test.ts
git commit -m "feat: define public location service contracts"
```

---

### Task 2: 实现高德 POI provider 和缓存

**Files:**
- Create: `payload-office-platform/src/domain/location-services/amap-provider.ts`
- Create: `payload-office-platform/src/domain/location-services/cache.ts`
- Modify: `payload-office-platform/src/domain/location-services/index.ts`
- Test: `payload-office-platform/tests/amap-location-provider.test.ts`

**Interfaces:**
- Produces: `createAmapLocationProvider({ key, fetchImpl })`.
- Produces: `getNearbyPois(buildingId, center, provider, now)`.
- Consumes: 高德 WebService `place/around` JSON；外部响应始终按 `unknown` 解析。

- [ ] **Step 1: 写 provider 失败测试**

```ts
it('只映射合法 POI 并限制为 5 条', async () => {
  const provider = createAmapLocationProvider({
    key: 'server-key',
    fetchImpl: mockAmapResponse(AMAP_POI_FIXTURE),
  })
  const result = await provider.nearby({
    center: { latitude: 31.23, longitude: 121.48 },
    category: 'bank',
    limit: 5,
  })
  expect(result).toHaveLength(5)
  expect(result[0]).toMatchObject({ source: 'amap-location-service' })
})

it('超时返回可分类错误而不是空成功', async () => {
  await expect(provider.nearby(INPUT)).rejects.toMatchObject({ code: 'provider_timeout' })
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/amap-location-provider.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 provider**

请求 URL 固定为高德 WebService 周边搜索接口，参数使用：

```ts
const location = `${longitude},${latitude}`
const url = new URL('https://restapi.amap.com/v3/place/around')
url.searchParams.set('location', location)
url.searchParams.set('keywords', keywordByCategory[category])
url.searchParams.set('radius', '1000')
url.searchParams.set('offset', '5')
url.searchParams.set('sortrule', 'distance')
url.searchParams.set('key', key)
```

设置 2500ms `AbortController`；非 2xx、业务 status 非 1、非法 JSON 分别映射稳定错误码。不得记录完整请求 URL，因为其中含 Key。

- [ ] **Step 4: 实现缓存**

缓存 key：

```ts
`poi:${buildingId}:${category}:${roundedLatitude}:${roundedLongitude}`
```

坐标仅保留小数点后 5 位；成功 TTL 24 小时，失败不缓存；领域事件 `building.updated` 使对应 building POI tag 失效。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/amap-location-provider.test.ts \
  tests/public-catalog-cache-invalidator.test.ts
pnpm typecheck
git add payload-office-platform/src/domain/location-services \
  payload-office-platform/tests/amap-location-provider.test.ts \
  payload-office-platform/tests/public-catalog-cache-invalidator.test.ts
git commit -m "feat: fetch and cache nearby Amap POIs"
```

---

### Task 3: 增加延迟地图和静态降级

**Files:**
- Create: `payload-office-platform/src/components/frontend/LocationPanel.tsx`
- Create: `payload-office-platform/src/components/frontend/AmapMapCanvas.tsx`
- Create: `payload-office-platform/src/lib/frontend/amap-map-loader.ts`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Test: `payload-office-platform/tests/e2e/detail-location.spec.ts`

**Interfaces:**
- Produces: `<LocationPanel location pois mapEnabled />`.
- Consumes: Task 2 POI 和 `NEXT_PUBLIC_AMAP_JS_KEY`.

- [ ] **Step 1: 写 E2E 失败测试**

```ts
test('地图失败仍显示地址和外部导航', async ({ page }) => {
  await page.route('**/webapi.amap.com/**', (route) => route.abort())
  await page.goto('/buildings/jingan-center')
  await page.getByRole('button', { name: '查看地图' }).click()
  await expect(page.getByText('地图暂时不可用')).toBeVisible()
  await expect(page.getByRole('button', { name: '复制地址' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开高德地图' })).toBeVisible()
})

test('进入视口前不加载地图 SDK', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/buildings/jingan-center')
  expect(requests.some((url) => url.includes('webapi.amap.com'))).toBe(false)
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test:e2e -- tests/e2e/detail-location.spec.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 loader 和地图 Canvas**

`loadAmapMap()` 返回单例 Promise；缺 Key、脚本失败和超时返回稳定错误。`AmapMapCanvas` 只在用户点击或 IntersectionObserver 命中后加载，不调用 Geolocation。

- [ ] **Step 4: 实现 POI 列表和降级**

四个类别使用语义 Tab；每类最多 5 项。点击 POI 只高亮 marker。静态区始终保留地址、最近地铁、复制地址和：

```ts
export function buildAmapPlaceUrl(
  name: string,
  coordinates: Coordinates,
): string {
  return `https://uri.amap.com/marker?position=${coordinates.longitude},${coordinates.latitude}&name=${encodeURIComponent(name)}`
}
```

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test:e2e -- tests/e2e/detail-location.spec.ts
pnpm typecheck
git add payload-office-platform/src/components/frontend/LocationPanel.tsx \
  payload-office-platform/src/components/frontend/AmapMapCanvas.tsx \
  payload-office-platform/src/lib/frontend/amap-map-loader.ts \
  'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/styles.css' \
  payload-office-platform/tests/e2e/detail-location.spec.ts
git commit -m "feat: add resilient detail page maps"
```

---

### Task 4: 完成视频和平面图媒体体验

**Files:**
- Modify: `payload-office-platform/src/components/frontend/DetailGallery.tsx`
- Create: `payload-office-platform/src/components/frontend/DetailVideo.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Test: `payload-office-platform/tests/e2e/detail-media.spec.ts`

**Interfaces:**
- Consumes: P0 `DetailMediaViewModel`.
- Produces: 分类切换、延迟原生 `<video>`、平面图声明。

- [ ] **Step 1: 写 E2E 失败测试**

```ts
test('视频不自动播放且只在用户操作后加载', async ({ page }) => {
  await page.goto('/listings/media-rich-listing')
  await expect(page.locator('video')).toHaveCount(0)
  await page.getByRole('tab', { name: '视频' }).click()
  const video = page.locator('video')
  await expect(video).toHaveCount(1)
  await expect(video).toHaveJSProperty('autoplay', false)
})

test('平面图展示示意声明', async ({ page }) => {
  await page.getByRole('tab', { name: '平面图' }).click()
  await expect(page.getByText('示意图，以现场实际情况为准')).toBeVisible()
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test:e2e -- tests/e2e/detail-media.spec.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现媒体分类**

`DetailGallery` 仅为非空分类渲染 Tab。`DetailVideo` 使用原生 controls、`preload="none"`、无 autoplay；视频 URL 只来自公开 Media DTO。

- [ ] **Step 4: 验证失败和可访问性**

单个视频/图片失败只移除当前媒体；关闭全屏焦点归还；左右键只在图片分类生效。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/components/frontend/DetailGallery.tsx \
  payload-office-platform/src/components/frontend/DetailVideo.tsx \
  'payload-office-platform/src/app/(frontend)/styles.css' \
  payload-office-platform/tests/e2e/detail-media.spec.ts
git commit -m "feat: add classified video and floor plans"
```

---

### Task 5: 实现 canonical 分享和本地收藏

**Files:**
- Create: `payload-office-platform/src/components/frontend/ShareSaveActions.tsx`
- Create: `payload-office-platform/src/lib/frontend/saved-details.ts`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Test: `payload-office-platform/tests/saved-details.test.ts`
- Test: `payload-office-platform/tests/e2e/detail-share-save.spec.ts`

**Interfaces:**
- Produces: `SavedDetail { type, id, slug, savedAt }`.
- Consumes: canonical URL 和不可变公开 ID。

- [ ] **Step 1: 写失败测试**

```ts
it('分享 URL 移除 query 和 hash', () => {
  expect(canonicalShareUrl('https://sbh.example/listings/a?utm_source=x#gallery'))
    .toBe('https://sbh.example/listings/a')
})

it('收藏对象不允许标题、价格或 PII', () => {
  expect(serializeSavedDetail({
    type: 'listing',
    id: 1,
    slug: 'a',
    savedAt: '2026-07-30T00:00:00.000Z',
  })).not.toContain('price')
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/saved-details.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现分享和收藏**

优先 `navigator.share({ url: canonical })`，不支持时复制 canonical。localStorage key 固定 `sbh:saved-details:v1`，最多 100 条，按不可变 `type:id` 去重。

- [ ] **Step 4: 浏览器验证**

```bash
pnpm test:e2e -- tests/e2e/detail-share-save.spec.ts
```

Expected: query 不进入剪贴板；收藏刷新后保留；禁用 localStorage 时显示非阻断提示。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/components/frontend/ShareSaveActions.tsx \
  payload-office-platform/src/lib/frontend/saved-details.ts \
  'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  payload-office-platform/tests/saved-details.test.ts \
  payload-office-platform/tests/e2e/detail-share-save.spec.ts
git commit -m "feat: add canonical sharing and local saves"
```

---

### Task 6: 实现可审计信息纠错

**Files:**
- Create: `payload-office-platform/src/collections/InformationCorrections.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/src/domain/corrections/schema.ts`
- Create: `payload-office-platform/src/app/(frontend)/api/corrections/route.ts`
- Create: `payload-office-platform/src/components/frontend/CorrectionModal.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Test: `payload-office-platform/tests/correction-domain.test.ts`
- Test: `payload-office-platform/tests/correction-api-route.test.ts`
- Generated: `payload-office-platform/src/migrations/*_information_corrections.ts`
- Generated: `payload-office-platform/src/migrations/*_information_corrections.json`

**Interfaces:**
- Produces: append-only `information-corrections`.
- Produces route response `{ ok: true }`,不暴露记录 ID.
- Consumes: target type/id、公开字段分类、可选说明、requestId。

- [ ] **Step 1: 写失败测试**

```ts
it('只允许公开纠错类别', () => {
  expect(validateCorrection({
    requestId: 'req-1',
    targetType: 'listing',
    targetSlug: 'a',
    category: 'price',
    description: '价格疑似有误',
  }).ok).toBe(true)
})

it('响应和日志不暴露提交人标识', async () => {
  const result = await runCorrection(VALID_REQUEST)
  expect(result.body).toEqual({ ok: true })
  expect(JSON.stringify(loggerInfo.mock.calls)).not.toContain('138')
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/correction-domain.test.ts tests/correction-api-route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 Collection、schema 和 route**

类别固定：

```ts
export const CORRECTION_CATEGORIES = [
  'price',
  'area',
  'availability',
  'media',
  'location',
  'building-fact',
  'other',
] as const
```

Collection 只追加，状态为 `new|triaged|resolved|rejected`；前台不可读。Route 执行同源、20KB body、schema、共享限流、requestId 幂等；创建记录后发布稳定任务事件。

- [ ] **Step 4: 生成迁移并接入 Modal**

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec payload migrate:create information-corrections
```

Modal 仅收类别和 500 字说明，不收手机号；提交后显示“已收到，我们会核实”，不展示后台状态。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/correction-domain.test.ts tests/correction-api-route.test.ts
pnpm typecheck
git add payload-office-platform/src/collections/InformationCorrections.ts \
  payload-office-platform/src/payload.config.ts \
  payload-office-platform/src/domain/corrections \
  'payload-office-platform/src/app/(frontend)/api/corrections/route.ts' \
  payload-office-platform/src/components/frontend/CorrectionModal.tsx \
  'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  payload-office-platform/src/payload-types.ts \
  payload-office-platform/src/app/'(payload)'/admin/importMap.js \
  payload-office-platform/src/migrations/index.ts \
  payload-office-platform/src/migrations/*information_corrections* \
  payload-office-platform/tests/correction-domain.test.ts \
  payload-office-platform/tests/correction-api-route.test.ts
git commit -m "feat: add auditable public information corrections"
```

---

### Task 7: P1 全量验证和证据

**Files:**
- Modify: `specs/work-items/FPD-P1-detail-enhancements.md`
- Create: `artifacts/verification/FPD-P1/README.md`
- Create: `artifacts/verification/FPD-P1/browser-matrix.md`
- Create: `artifacts/verification/FPD-P1/provider-failure-matrix.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: P1 验证证据。

- [ ] **Step 1: 执行迁移与静态门禁**

```bash
pnpm migrate:dry-run
pnpm migrate:verify
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm typecheck
pnpm lint
pnpm test
NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build
```

Expected: 全部 exit 0。

- [ ] **Step 2: 执行 P1 E2E**

```bash
pnpm test:e2e -- tests/e2e/detail-location.spec.ts \
  tests/e2e/detail-media.spec.ts \
  tests/e2e/detail-share-save.spec.ts \
  tests/e2e/detail-pages.spec.ts
```

Expected: PASS。

- [ ] **Step 3: 人工验证第三方故障矩阵**

验证：无 JS Key、WebService 401、超时、非法响应、SDK 阻断、无坐标、POI 空结果。每种情况均保留地址、供给和咨询。

- [ ] **Step 4: 写安全与成本记录**

证据记录 Key 域名白名单、WebService 配额/告警、缓存命中、请求超时、未请求用户定位、日志无 Key/PII。

- [ ] **Step 5: 提交证据**

```bash
git add specs/work-items/FPD-P1-detail-enhancements.md \
  artifacts/verification/FPD-P1
git commit -m "test: verify detail pages P1 enhancements"
```

---

## P1 Definition of Done

- 高德地图服务为唯一地图/POI 真源，Key 权限和域名白名单有证据。
- 地图/POI/视频失败不影响楼盘事实、有效供给和咨询。
- 平面图、视频和实景媒体分组明确且可访问。
- 分享只使用 canonical；收藏只保存不可识别 ID。
- 纠错只追加、可审计、前台不可读取处理状态。
- 类型、lint、全量测试、构建、迁移和 P1 浏览器矩阵全绿。
