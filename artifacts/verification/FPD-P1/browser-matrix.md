# FPD-P1 浏览器矩阵

> 范围：P1 详情页增强（地图/POI、分类媒体、分享/收藏、纠错）在浏览器维度的验证证据。
> 依据：`docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md` Task 7 Step 2。
> 配置：`payload-office-platform/playwright.config.ts`。

## 1. 浏览器引擎

| 引擎 | 是否纳入 | 原因 |
|---|---|---|
| Chromium（Desktop Chrome） | 是 | `playwright.config.ts:45-49` 唯一启用项目。性能预算约束（`playwright.config.ts:7` 注释「仅启用 chromium（项目性能预算约束）」）。 |
| Firefox | 否 | P1 不纳入，受性能预算约束；P0/P1 全链路 E2E 统一以 chromium 为基准。 |
| WebKit | 否 | 同上。 |

> 跨引擎视觉回归由独立产物 `artifacts/verification/f7-2-visual-review/` 覆盖（多断点截图），不属 P1 功能矩阵。

## 2. 测试矩阵（Chromium）

本地 `next dev`（端口 3718，避免与 p0-core 工作树的陈旧 server 3717 复用），`reuseExistingServer` 关闭式独立启动。`fullyParallel: false`、`workers: 1`（顺序执行，消除并发竞态）。

| Spec | 用例数 | 覆盖 | 结果 |
|---|---|---|---|
| `tests/e2e/detail-location.spec.ts` | 2 | 地图 SDK 阻断降级仍显示地址/外链；进入视口前不加载 SDK（懒加载） | 2 passed |
| `tests/e2e/detail-media.spec.ts` | 3 | 默认图片 Tab 无 video（视频不进首屏 SSR）；视频延迟挂载不自动播放；平面图示意图声明 | 3 passed |
| `tests/e2e/detail-share-save.spec.ts` | 3 | 分享复制 canonical 不含 query/hash；收藏刷新后保留；禁用 localStorage 显示非阻断提示且分享仍可用 | 3 passed |
| `tests/e2e/detail-pages.spec.ts` | 22 | 媒体 Tab 适配、视频对话框焦点循环、详情锚点键盘可达 + 减少动效、楼盘有效供给分组 | 22 passed |
| **合计** | **30** | | **30 passed（45.0s）** |

## 3. 覆盖的详情路由与 seed

- 楼盘详情 `/buildings/west-nanjing-premium-center`（完整坐标，验证地图/POI）。
- 房源详情 `/listings/media-rich-listing`（2 图片 + 1 视频 + 1 平面图，验证分类媒体 Tab）。
- 房源详情 `/listings/jingan-serviced-office-42-seats`（验证视频对话框焦点循环）。

## 4. 焦点循环 flakiness 修复

`detail-pages.spec.ts:180 视频对话框的原生控件参与双向焦点循环` 在套件负载下偶发失败（Shift+Tab 后视频控件 `inactive`，10s 内未获焦）。根因：对话框 `useEffect` 注册 keydown 焦点循环处理的时机晚于 Playwright `press`，导致 trap 未触发。修复：将 `close.focus()` 改为 `expect(close).toBeFocused()`，等待 effect 的 rAF 初始聚焦（handler 先于 rAF 注册），确保 trap 已挂载再触发按键。

验证：`--repeat-each=5` 连跑 5 次全过（5 passed, 15.2s）；修复后 4 spec 全量 30 passed。CI 侧 `retries: 2`（`playwright.config.ts:34`）作为兜底。

## 5. CI 执行约定

- CI 用 `next start`（生产构建，消除逐路由 JIT 编译慢，`playwright.config.ts:8`）。
- `baseURL` 恒指向本地 server（`PLAYWRIGHT_BASE_URL ?? localhost:PORT`），**绝不**用 `NEXT_PUBLIC_SITE_URL` 当 baseURL（生产 fail-closed 守卫要求其为线上 https，会误把 E2E 打到线上）。
- `forbidOnly: !!CI`、`retries: 2`、失败保留 trace + 截图 + 视频。
