# 房源与楼盘详情 P2 路线、预约与推荐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P1 稳定基础上增加用户主动触发的路线建议、可选择但待顾问确认的看房时段、平台服务状态和可解释的情境推荐。

**Architecture:** 路线能力复用 P1 `LocationProvider` 并在用户明确点击后才读取一次性位置；服务时段使用平台级规则而非公开个人顾问排班；预约时段作为 Lead 的偏好而非已确认日历。推荐由当前实体、显式筛选和有效供给计算，不建立跨会话用户画像。

**Tech Stack:** Next.js 16、React 19、Payload 3.86、Tencent Location Service、PostgreSQL、Vitest、Playwright。

## Global Constraints

- 依赖 P0 与 P1 完成。
- 执行前创建独立 worktree `codex/detail-pages-p2-guidance`、独立端口和独立 PostgreSQL 数据库。
- 用户定位只能在点击“查看到这里的路线”后读取；拒绝、超时或不支持时回退外部导航。
- 原始用户坐标不持久化、不写日志、不进入埋点、不写 Lead。
- 预约始终显示“待顾问确认”；P2 不建设实时日历锁位。
- 前台只显示平台服务状态，不公开个人顾问手机号、精确排班或在线轨迹。
- 推荐必须输出 `reasonCodes`，只使用当前页面和用户显式筛选，不使用跨会话画像。
- 证据写入 `artifacts/verification/FPD-P2/README.md`，任务包写入 `specs/work-items/FPD-P2-detail-guidance.md`。

---

## File Map

| 文件 | 单一职责 |
|---|---|
| `src/domain/location-services/routes.ts` | 路线输入、响应白名单和隐私边界 |
| `src/app/(frontend)/api/routes/route.ts` | 同源、限流、无日志坐标的路线摘要代理 |
| `src/components/frontend/RoutePlanner.tsx` | 主动授权、路线摘要和降级 |
| `src/globals/AdvisorServiceHours.ts` | 平台服务时间、时段和节假日 |
| `src/domain/advisor-availability/service-hours.ts` | Asia/Shanghai 时段解析和状态 |
| `src/domain/inquiry/viewing-slots.ts` | 合法预约偏好时段 |
| `src/components/frontend/AdvisorAvailability.tsx` | 平台服务状态 |
| `src/components/frontend/ViewingSlotPicker.tsx` | 待确认预约时段选择 |
| `src/domain/recommendation/detail-recommendations.ts` | 可解释情境推荐 |
| `src/components/frontend/RecommendationReason.tsx` | 推荐理由标签 |

---

### Task 1: 建立 P2 任务包和路线隐私契约

**Files:**
- Create: `specs/work-items/FPD-P2-detail-guidance.md`
- Create: `payload-office-platform/src/domain/location-services/routes.ts`
- Modify: `payload-office-platform/src/domain/location-services/contracts.ts`
- Modify: `payload-office-platform/src/domain/location-services/index.ts`
- Test: `payload-office-platform/tests/location-routes.test.ts`

**Interfaces:**
- Produces: `RouteMode`, `RouteSummary`, `RouteProvider.route(input)`.
- Consumes: P1 `Coordinates`；不返回原始起点。

- [ ] **Step 1: 写失败测试**

```ts
it('路线摘要不包含原始起点坐标', async () => {
  const summary = await provider.route({
    origin: { latitude: 31.20, longitude: 121.40 },
    destination: { latitude: 31.23, longitude: 121.48 },
    mode: 'transit',
  })
  expect(summary).toEqual({
    mode: 'transit',
    durationMinutes: 36,
    distanceMeters: 12500,
    transfers: 1,
    source: 'tencent-location-service',
  })
  expect(JSON.stringify(summary)).not.toContain('31.20')
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/location-routes.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 定义稳定接口**

```ts
export const ROUTE_MODES = ['transit', 'driving', 'walking'] as const
export type RouteMode = (typeof ROUTE_MODES)[number]

export type RouteSummary = Readonly<{
  mode: RouteMode
  durationMinutes: number
  distanceMeters: number
  transfers: number | null
  source: 'tencent-location-service'
}>

export interface RouteProvider {
  route(input: Readonly<{
    origin: Coordinates
    destination: Coordinates
    mode: RouteMode
  }>): Promise<RouteSummary>
}
```

- [ ] **Step 4: 扩展腾讯 provider**

使用腾讯路线 WebService；请求只在当前交互内存在。日志仅记录 mode、成功/失败、耗时区间，不记录 URL 或坐标。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/location-routes.test.ts
pnpm typecheck
git add specs/work-items/FPD-P2-detail-guidance.md \
  payload-office-platform/src/domain/location-services \
  payload-office-platform/tests/location-routes.test.ts
git commit -m "feat: define privacy-safe route summaries"
```

---

### Task 2: 实现用户主动触发的路线建议

**Files:**
- Create: `payload-office-platform/src/components/frontend/RoutePlanner.tsx`
- Create: `payload-office-platform/src/app/(frontend)/api/routes/route.ts`
- Modify: `payload-office-platform/src/components/frontend/LocationPanel.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Test: `payload-office-platform/tests/location-route-api.test.ts`
- Test: `payload-office-platform/tests/e2e/detail-route-planner.spec.ts`

**Interfaces:**
- Produces: `<RoutePlanner destination destinationName />` 和 `POST /api/routes`.
- Consumes: Task 1 `RouteProvider` 和浏览器 Geolocation。

- [ ] **Step 1: 写 E2E 失败测试**

```ts
test('页面加载时不请求定位', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/buildings/jingan-center')
  await expect(page.getByText('允许定位')).toHaveCount(0)
})

test('拒绝定位后保留外部导航', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/buildings/jingan-center')
  await page.getByRole('button', { name: '查看到这里的路线' }).click()
  await expect(page.getByText('无法获取当前位置')).toBeVisible()
  await expect(page.getByRole('link', { name: '打开腾讯地图' })).toBeVisible()
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test:e2e -- tests/e2e/detail-route-planner.spec.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现一次性定位**

仅在 button handler 中调用：

```ts
navigator.geolocation.getCurrentPosition(onSuccess, onError, {
  enableHighAccuracy: false,
  timeout: 5000,
  maximumAge: 60_000,
})
```

坐标只保存在当前组件内存，组件关闭或页面卸载后释放。

- [ ] **Step 4: 实现隐私安全代理并渲染路线摘要**

`POST /api/routes` 只接受：

```ts
type RouteSummaryRequest = Readonly<{
  origin: Coordinates
  destination: Coordinates
  mode: RouteMode
  requestId: string
}>
```

Route 执行同源检查、10KB body、schema、共享限流和 2500ms provider 超时。访问日志不得记录 request body 或完整 URL；响应只返回 `RouteSummary`。

展示时间、距离、换乘次数和来源；不绘制精确起点 marker。分析只记录 `route_mode`、`permission_result`、`duration_bucket`。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/location-route-api.test.ts
pnpm test:e2e -- tests/e2e/detail-route-planner.spec.ts
pnpm typecheck
git add payload-office-platform/src/components/frontend/RoutePlanner.tsx \
  'payload-office-platform/src/app/(frontend)/api/routes/route.ts' \
  payload-office-platform/src/components/frontend/LocationPanel.tsx \
  'payload-office-platform/src/app/(frontend)/styles.css' \
  payload-office-platform/tests/location-route-api.test.ts \
  payload-office-platform/tests/e2e/detail-route-planner.spec.ts
git commit -m "feat: add opt-in route planning"
```

---

### Task 3: 建立平台服务时间和公开状态

**Files:**
- Create: `payload-office-platform/src/globals/AdvisorServiceHours.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/src/domain/advisor-availability/service-hours.ts`
- Create: `payload-office-platform/src/domain/advisor-availability/index.ts`
- Create: `payload-office-platform/src/components/frontend/AdvisorAvailability.tsx`
- Test: `payload-office-platform/tests/advisor-service-hours.test.ts`
- Generated: `payload-office-platform/src/migrations/*_advisor_service_hours.ts`
- Generated: `payload-office-platform/src/migrations/*_advisor_service_hours.json`

**Interfaces:**
- Produces: `resolveServiceStatus(schedule, now, 'Asia/Shanghai')`.
- Produces: `ServiceStatus { state, nextOpenAt, message }`.
- Consumes: 平台级工作日/时段/节假日，不包含个人顾问。

- [ ] **Step 1: 写时区和边界失败测试**

```ts
it('周一 09:00 开始时为服务中', () => {
  expect(resolveServiceStatus(SCHEDULE, '2026-08-03T01:00:00.000Z')).toMatchObject({
    state: 'open',
  })
})

it('节假日优先于常规周配置', () => {
  expect(resolveServiceStatus(HOLIDAY_SCHEDULE, '2026-10-01T03:00:00.000Z')).toMatchObject({
    state: 'closed',
  })
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/advisor-service-hours.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 Global 和纯函数**

Global 字段：时区固定 `Asia/Shanghai`、周一至周日多个时间段、例外日期、公开消息。纯函数返回：

```ts
type ServiceStatus = Readonly<{
  state: 'open' | 'closed'
  nextOpenAt: string | null
  message: string
}>
```

- [ ] **Step 4: 生成迁移并接入详情页**

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec payload migrate:create advisor-service-hours
```

`AdvisorAvailability` 只显示“当前服务中”或“当前非服务时段，预计 X 恢复”，不显示个人在线状态。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/advisor-service-hours.test.ts
pnpm typecheck
git add payload-office-platform/src/globals/AdvisorServiceHours.ts \
  payload-office-platform/src/payload.config.ts \
  payload-office-platform/src/domain/advisor-availability \
  payload-office-platform/src/components/frontend/AdvisorAvailability.tsx \
  payload-office-platform/src/payload-types.ts \
  payload-office-platform/src/app/'(payload)'/admin/importMap.js \
  payload-office-platform/src/migrations/index.ts \
  payload-office-platform/src/migrations/*advisor_service_hours* \
  payload-office-platform/tests/advisor-service-hours.test.ts
git commit -m "feat: expose platform advisor service hours"
```

---

### Task 4: 增加待确认看房时段

**Files:**
- Create: `payload-office-platform/src/domain/inquiry/viewing-slots.ts`
- Modify: `payload-office-platform/src/domain/inquiry/schema.ts`
- Modify: `payload-office-platform/src/collections/Leads.ts`
- Modify: `payload-office-platform/src/app/(frontend)/api/inquiries/route.ts`
- Create: `payload-office-platform/src/components/frontend/ViewingSlotPicker.tsx`
- Modify: `payload-office-platform/src/components/frontend/InquiryModal.tsx`
- Test: `payload-office-platform/tests/viewing-slots.test.ts`
- Test: `payload-office-platform/tests/inquiry-api-route.test.ts`
- Generated: `payload-office-platform/src/migrations/*_lead_viewing_preference.ts`
- Generated: `payload-office-platform/src/migrations/*_lead_viewing_preference.json`

**Interfaces:**
- Produces: `ViewingPreference { startsAt, endsAt, timezone, status: 'pending-confirmation' }`.
- Consumes: Task 3 服务时间和用户选择；不产生已确认预约。

- [ ] **Step 1: 写失败测试**

```ts
it('只生成未来 14 天内落在服务时间的 2 小时时段', () => {
  const slots = buildViewingSlots(SCHEDULE, '2026-07-30T00:00:00.000Z')
  expect(slots.every((slot) => slot.durationMinutes === 120)).toBe(true)
  expect(slots.every((slot) => slot.status === 'pending-confirmation')).toBe(true)
})

it('提交时拒绝过期或不在服务时间的 slot', () => {
  expect(validateViewingPreference(EXPIRED_SLOT, SCHEDULE, NOW)).toEqual({
    ok: false,
    error: 'viewing_slot_invalid',
  })
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/viewing-slots.test.ts tests/inquiry-api-route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现时段和 schema**

只允许未来 14 天、服务时间内、30 分钟边界、持续 2 小时。Lead 保存开始/结束、时区和 `pending-confirmation`，不保存“confirmed”。

- [ ] **Step 4: 接入表单和迁移**

`ViewingSlotPicker` 放在咨询第二步，标题固定“偏好看房时间（待顾问确认）”。提交成功文案再次声明待确认。

```bash
pnpm exec payload generate:types
pnpm exec payload migrate:create lead-viewing-preference
```

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/viewing-slots.test.ts tests/inquiry-api-route.test.ts
pnpm typecheck
git add payload-office-platform/src/domain/inquiry/viewing-slots.ts \
  payload-office-platform/src/domain/inquiry/schema.ts \
  payload-office-platform/src/collections/Leads.ts \
  'payload-office-platform/src/app/(frontend)/api/inquiries/route.ts' \
  payload-office-platform/src/components/frontend/ViewingSlotPicker.tsx \
  payload-office-platform/src/components/frontend/InquiryModal.tsx \
  payload-office-platform/src/payload-types.ts \
  payload-office-platform/src/migrations/index.ts \
  payload-office-platform/src/migrations/*lead_viewing_preference* \
  payload-office-platform/tests/viewing-slots.test.ts \
  payload-office-platform/tests/inquiry-api-route.test.ts
git commit -m "feat: collect pending viewing preferences"
```

---

### Task 5: 实现可解释情境推荐

**Files:**
- Create: `payload-office-platform/src/domain/recommendation/detail-recommendations.ts`
- Create: `payload-office-platform/src/domain/recommendation/index.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/facade.ts`
- Create: `payload-office-platform/src/components/frontend/RecommendationReason.tsx`
- Modify: `payload-office-platform/src/components/frontend/ListingCard.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Test: `payload-office-platform/tests/detail-recommendations.test.ts`

**Interfaces:**
- Produces: `rankDetailRecommendations(candidates, context)`.
- Produces: `RecommendationResult { listing, score, reasonCodes }`.
- Consumes: 当前 listing/building DTO、显式 URL 筛选和当前有效供给候选。

- [ ] **Step 1: 写排序和隐私失败测试**

```ts
it('同商圈、同单位、相近面积按稳定 ID 收束', () => {
  const results = rankDetailRecommendations(CANDIDATES, CONTEXT)
  expect(results[0].reasonCodes).toEqual([
    'same-business-area',
    'same-price-unit',
    'similar-area',
  ])
  expect(results.map((x) => x.listing.id)).toEqual([12, 18, 23])
})

it('context 不接受用户 ID、手机号或跨会话历史', () => {
  expect(parseRecommendationContext({ phone: '13800001111' })).toEqual({
    ok: false,
    error: 'invalid_context',
  })
})
```

- [ ] **Step 2: 运行红灯**

```bash
pnpm test -- tests/detail-recommendations.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现确定性打分**

权重固定：

```ts
const WEIGHTS = {
  sameBusinessArea: 40,
  sameListingType: 25,
  samePriceUnit: 20,
  similarArea: 10,
  similarPrice: 5,
} as const
```

同分使用不可变 listing ID 升序。最多返回 6 条，每条至少一个 reasonCode；不读取 cookie、localStorage、用户 ID 或 Lead。

- [ ] **Step 4: 接入公开 Facade 和页面**

Facade 先调用统一有效供给查询，再打分。卡片展示最多两个可读理由，如“同商圈”“面积相近”，事件记录 reasonCodes 和排名。

- [ ] **Step 5: 跑绿并提交**

```bash
pnpm test -- tests/detail-recommendations.test.ts \
  tests/public-catalog-effective-supply-consistency.test.ts
pnpm typecheck
git add payload-office-platform/src/domain/recommendation \
  payload-office-platform/src/domain/public-catalog/facade.ts \
  payload-office-platform/src/components/frontend/RecommendationReason.tsx \
  payload-office-platform/src/components/frontend/ListingCard.tsx \
  'payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx' \
  'payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx' \
  payload-office-platform/tests/detail-recommendations.test.ts
git commit -m "feat: add explainable contextual recommendations"
```

---

### Task 6: P2 全量验证和证据

**Files:**
- Modify: `specs/work-items/FPD-P2-detail-guidance.md`
- Create: `artifacts/verification/FPD-P2/README.md`
- Create: `artifacts/verification/FPD-P2/privacy-matrix.md`
- Create: `artifacts/verification/FPD-P2/browser-matrix.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: P2 完成证据。

- [ ] **Step 1: 执行迁移和静态门禁**

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

- [ ] **Step 2: 执行 P2 E2E**

```bash
pnpm test:e2e -- tests/e2e/detail-route-planner.spec.ts \
  tests/e2e/inquiry-flow.spec.ts \
  tests/e2e/detail-pages.spec.ts \
  tests/e2e/f7-3-accessibility.spec.ts
```

Expected: PASS。

- [ ] **Step 3: 验证隐私矩阵**

验证首次加载不请求定位、拒绝定位可降级、允许后只请求一次、坐标不出现在网络日志/分析/Lead、推荐不读取跨会话数据。

- [ ] **Step 4: 验证预约边界**

验证服务中/非服务时段、节假日、时区边界、过期时段、提交瞬间时段失效和“待确认”文案。

- [ ] **Step 5: 提交证据**

```bash
git add specs/work-items/FPD-P2-detail-guidance.md \
  artifacts/verification/FPD-P2
git commit -m "test: verify detail pages P2 guidance"
```

---

## P2 Definition of Done

- 未经用户主动操作不读取定位；原始坐标无持久化和日志痕迹。
- 路线拒绝/失败时仍可外部导航和咨询。
- 前台只公开平台服务状态，不公开个人顾问状态。
- 所有预约时段均为待确认，服务端复核时段有效性。
- 推荐可解释、确定性、只使用显式当前上下文并复用有效供给。
- 类型、lint、全量测试、构建、迁移和 P2 浏览器/隐私矩阵全绿。
