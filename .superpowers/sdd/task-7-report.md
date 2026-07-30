# Task 7：楼盘详情页重构报告

## 范围与实现

- 路由现在只通过 public-catalog facade 消费公开 DTO：同一 `SearchContext` 下调用
  `getBuildingDetail(slug, ctx, supplyInput)` 和 `getRelatedBuildings(slug, ctx)`。
- 页面按 PRD 顺序组合 `DetailGallery`、`DetailFacts`、`DetailAnchorNav`、
  `BuildingSupplyBrowser`、说明、相关楼盘和 `InquiryModal`；相关楼盘再按 DTO id
  防御性排除当前楼盘。
- 供给按出租/出售/联合办公的非空组输出。移动端固定卡片；桌面可在卡片和表格间切换。
  `ListingCard` 的 `variant="building-supply"` 仍仅接收 `ListingCardViewModel`。
- 零供给时固定显示“当前暂无公开可选空间”，不渲染组 tab、价格区间或 JSON-LD 报价。
- `data-supply-as-of={supply.asOf}` 同时位于供给聚合 section 和浏览器根节点；没有第二次
  供给读取。

## RED → GREEN

先在 `tests/e2e/detail-pages.spec.ts` 加入三条失败 E2E：非空有效供给组、公开零供给楼盘、
聚合/列表共用 asOf。首次在隔离端口 3727 运行时失败，原因符合预期：旧页面没有“当前有效供给”
标题/role=tab，`empty-building` 尚不存在，且没有快照属性。实现和种子数据后，测试全绿。

## 种子路由与有效供给证据

- 非空：`/buildings/west-nanjing-premium-center`。E2E 断言仅出现“出租”，并且
  `building-supply` 卡片为 3 条；属于同楼盘但 `supplyVisibilityHold=pending_recheck` 的
  `jingan-published-pending-recheck` 没有计入。
- 空供给：`/buildings/empty-building`。`scripts/seed.ts` 幂等写入真实公开楼盘
  （`status=published`、`operationalStatus=active`、上海/静安/南京西路商圈），但不创建房源或
  关系；重新 seed 后路由返回 200。
- 查询/asOf：页面只构造一次 `ctx`；facade 的既有 domain 测试断言楼内有效房源只读一次并与
  building 查询使用同一 `asOf`。新增 E2E 进一步断言两个 DOM 容器的
  `data-supply-as-of` 属性完全相同。

## 修改文件

- `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- `payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx`
- `payload-office-platform/src/components/frontend/ListingCard.tsx`
- `payload-office-platform/src/app/(frontend)/styles.css`
- `payload-office-platform/scripts/seed.ts`
- `payload-office-platform/tests/e2e/detail-pages.spec.ts`

## 验证

- RED：`PORT=3727 PLAYWRIGHT_BASE_URL=http://localhost:3727 pnpm exec playwright test tests/e2e/detail-pages.spec.ts --project=chromium`（新增三例按预期失败）。
- Focused：`pnpm exec vitest run tests/building-supply.test.ts tests/detail-components-contract.test.ts` — 2 files / 14 tests passed。
- E2E GREEN：同一条 3727 直接 Playwright 命令 — 6 passed。
- Node 22.23.2：`typecheck` passed；全量 `vitest run` — 125 files / 2189 tests passed。
- `git diff --check` passed。

## 自检与关注项

- 已确认页面未读取 Payload 文档，也未拼接查询条件；过滤仍由严格的异步 `searchParams` →
  `parseBuildingSupplySearchParams` 输入链路控制。
- 已确认空供给不产生最低价/报价措辞，待复核 fixture 不会进入有效供给。
- 无功能阻塞。seed 期间仍会出现项目既有的 PostgreSQL client deprecation warning，与本改动无关。
