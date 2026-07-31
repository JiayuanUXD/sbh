# Task Packet：FPD-P1 房源与楼盘详情增强

> 状态：已完成
> 创建日期：2026-07-31
> 最后更新：2026-07-31

## 1. 目标

在 P0 详情页基础上增加分类视频/平面图、高德地图与周边 POI、分享/本地收藏和可审计信息纠错，同时保证第三方失败不影响供给和咨询。

## 2. 非目标

- 不包含 P2 路线规划、预约时段、顾问状态。
- 不接入高德以外的地图/POI 供应商（腾讯、百度等）。
- POI 不进入 JSON-LD；地图和视频均不进入首屏关键链路。
- 不实现路线规划，只提供第三方地图打开链接。

## 3. 权威上下文

- 计划：`docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md`
- 页面 PRD：FP-03 房源详情、FP-04 楼盘详情（P1 增强段）。
- 证据：`artifacts/verification/FPD-P1/README.md`（Task 7 产出）。

## 4. 当前行为与证据

- 地图供应商：高德地图（JS API + WebService），已从原腾讯位置服务切换。
- 验证目标提交：`test: 详情页 P1 全量验证与证据（Task 7）`（Task 7 Step 5）。

## 5. 影响范围

- 数据模型/迁移：新增只追加 `information-corrections` collection 及迁移（Task 6）。
- 领域：`domain/location-services`（契约/provider/缓存）、`domain/corrections`（schema）。
- 前台：LocationPanel、AmapMapCanvas、DetailGallery/DetailVideo、ShareSaveActions、CorrectionModal；两个详情路由接入。
- 风险控制：地图/POI/视频失败降级不阻断供给与咨询；Key 域名白名单与服务端隔离；纠错不收 PII、前台不可读处理状态；收藏仅本地不可识别 ID。

## 6. 实施清单

- [x] Task 1：建立 P1 任务包和位置服务契约（`contracts.ts` / `index.ts`）。
- [x] Task 2：实现高德 POI provider 和缓存。
- [x] Task 3：增加延迟地图和静态降级。
- [x] Task 4：完成视频和平面图媒体体验。
- [x] Task 5：实现 canonical 分享和本地收藏。
- [x] Task 6：实现可审计信息纠错。
- [x] Task 7：P1 全量验证和证据。

## 7. 验收

- 高德地图服务为唯一地图/POI 真源，Key 权限和域名白名单有证据。
- 地图/POI/视频失败不影响楼盘事实、有效供给和咨询。
- 平面图、视频和实景媒体分组明确且可访问。
- 分享只使用 canonical；收藏只保存不可识别 ID。
- 纠错只追加、可审计、前台不可读取处理状态。
- 类型、lint、全量测试、构建、迁移和 P1 浏览器矩阵全绿。

## 8. 结果

- 进行中：Task 1-5 已完成。契约 5 tests + provider/缓存 13 tests PASS（合计全量 2244 PASS）、typecheck PASS、lint PASS（0 error）。
  Task 3 详情页位置交通：amap-map-loader（点击加载 SDK、5s 超时）、AmapMapCanvas（失败兜底）、LocationPanel（地址/最近地铁/复制地址/高德外链 + POI 分类 tab）、location-pois 服务端聚合；e2e 2 passed（地图失败兜底 + 进入视口前不加载 SDK）、typecheck PASS、lint 0 error。
  注：本地 sbh_dev 曾落后 6 个 migration（0728-0731）导致 detail 页 500，已重建库 fresh migrate + seed 修复。
  Task 4 视频和平面图媒体体验：DetailGallery 重构为分类 Tab（图片/视频/平面图，仅非空分类渲染 Tab，默认图片）、DetailVideo 延迟挂载（preload="none"、无 autoplay，仅在切到「视频」Tab 后挂载）、平面图示意图声明（figcaption 注 + 面板底部 note）；左右键翻页仅图片分类生效，视频对话框无上/下一张。seed 增 media-rich-listing（2 图片 + 1 视频 + 1 平面图，三类齐全）并补 listing-merchant-relations 使其通过有效供给精筛。e2e detail-media 3 passed（默认图片无 video + 视频延迟挂载不自动播放 + 平面图示意声明）、detail-pages 22 passed（媒体 Tab 适配 + 楼盘供给 count 3→4）、detail-location 2 passed、disabled-supply/frontend-journey/inquiry-flow 16 passed；typecheck PASS、lint 0 error。
  Task 5 canonical 分享与本地收藏：saved-details.ts 纯函数 + localStorage CRUD（key `sbh:saved-details:v1`，按 `type:id` 去重置顶，最多 100 条，仅存 type/id/slug/savedAt 不可识别 ID，写入后派发 `SAVED_CHANGE_EVENT`）；canonicalShareUrl 净化（移除 query/hash，utm/锚点不外泄）；ShareSaveActions 用 useSyncExternalStore 订阅 localStorage（SSR 安全，规避 react-hooks/set-state-in-effect），分享优先 navigator.share 降级剪贴板、收藏 aria-pressed/aria-label 反映状态、禁用 localStorage 时收藏 disabled + 非阻断提示且分享仍可用；listings/[slug] + buildings/[slug] 详情页接入。vitest saved-details 7 passed、e2e detail-share-save 3 passed（分享复制 canonical 不含 query/hash + 收藏刷新后保留 + 禁用 localStorage 提示且分享可用）、detail-pages 22 + detail-location 2 回归 passed；typecheck PASS、lint 0 error。
  Task 6 可审计信息纠错：只追加 `information-corrections` collection（status new|triaged|resolved|rejected，access create()=true、delete()=false、read/update 需 correction:read/manage 权限故前台不可读处理状态；beforeChange 保护钩子创建强制 status=new、更新回滚 IMMUTABLE_FIELDS；afterChange 写 domain-events Outbox 派发 correction.created）；domain/corrections 纯 TS 模块（schema 7 类别白名单 + 500 字描述上限、idempotency sha256(requestId|targetType|targetSlug|category)、privacy-log 剥离描述正文与原始 IP 仅留 32 位 IP 哈希、事件发布器）；/api/corrections 路由 8 步（同源 + Content-Type + 20KB body + schema + requestId 幂等 + 共享 PG 限流 correction: 前缀独立配额 3/min + 创建 + 唯一冲突兜底，响应仅 {ok:true} 不泄漏记录 ID）；CorrectionModal（类别 select + 500 字 textarea + 字数计数，不收姓名/电话，提交后显示「已收到，我们会核实」，analytics 仅枚举不传描述正文）；listings/[slug] + buildings/[slug] 详情页 decision 区接入；迁移 20260731_120000_information_corrections（枚举类型 + domain_events 事件/聚合类型扩值 + 幂等唯一索引 + locked_documents_rels 列）；event-types/permission-codes/rate-limit-config 扩容。vitest correction-domain 14 + correction-api-route 15 = 29 passed（类别白名单/幂等稳定/隐私日志/同源 403/415/413/429/GET 405 等）；typecheck PASS、lint 0 error。
  注：原 3 个 pre-existing 失败已在 Task 7 Step 1 修复——frontend-mappers latitude/longitude x2（`mapCoordinates` 引入 `PUBLIC_COORDINATE_PRECISION=4` 截断，~11m 建筑级，满足 PRD「高精度内部坐标不得进入 DTO」；内部距离计算仍用原始坐标不受影响）、detail-components-contract `<video>`（拆分为 image-only / video-only 两次渲染，适配 Task 4 分类 Tab 默认仅渲染图片 Tab）。Task 6 自身 29 测试通过，未引入新回归。
  Task 7 P1 全量验证和证据：静态门禁全绿（migrate:dry-run/verify 0 fail、generate:types/importmap、typecheck PASS、lint 0 error、vitest 2280 passed/133 files、`NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build` 成功含 /api/corrections 路由）；P1 E2E 4 spec 30 passed（detail-location 2 + detail-media 3 + detail-share-save 3 + detail-pages 22，独立端口 3718 规避 p0-core 陈旧 server 复用）；视频对话框焦点循环 flakiness 修复（`close.focus()` 改 `expect(close).toBeFocused()` 等 effect rAF 聚焦确保 trap handler 已注册，`--repeat-each=5` 全过）。第三方故障矩阵 7 类模式 + 安全成本记录见 `artifacts/verification/FPD-P1/`（README/browser-matrix/provider-failure-matrix）。验证提交 `test: 详情页 P1 全量验证与证据（Task 7）`。
