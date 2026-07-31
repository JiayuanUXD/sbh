# Task Packet：FPD-P1 房源与楼盘详情增强

> 状态：进行中
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
- 验证目标提交：（Task 7 填写）。

## 5. 影响范围

- 数据模型/迁移：新增只追加 `information-corrections` collection 及迁移（Task 6）。
- 领域：`domain/location-services`（契约/provider/缓存）、`domain/corrections`（schema）。
- 前台：LocationPanel、AmapMapCanvas、DetailGallery/DetailVideo、ShareSaveActions、CorrectionModal；两个详情路由接入。
- 风险控制：地图/POI/视频失败降级不阻断供给与咨询；Key 域名白名单与服务端隔离；纠错不收 PII、前台不可读处理状态；收藏仅本地不可识别 ID。

## 6. 实施清单

- [x] Task 1：建立 P1 任务包和位置服务契约（`contracts.ts` / `index.ts`）。
- [x] Task 2：实现高德 POI provider 和缓存。
- [x] Task 3：增加延迟地图和静态降级。
- [ ] Task 4：完成视频和平面图媒体体验。
- [ ] Task 5：实现 canonical 分享和本地收藏。
- [ ] Task 6：实现可审计信息纠错。
- [ ] Task 7：P1 全量验证和证据。

## 7. 验收

- 高德地图服务为唯一地图/POI 真源，Key 权限和域名白名单有证据。
- 地图/POI/视频失败不影响楼盘事实、有效供给和咨询。
- 平面图、视频和实景媒体分组明确且可访问。
- 分享只使用 canonical；收藏只保存不可识别 ID。
- 纠错只追加、可审计、前台不可读取处理状态。
- 类型、lint、全量测试、构建、迁移和 P1 浏览器矩阵全绿。

## 8. 结果

- 进行中：Task 1-3 已完成。契约 5 tests + provider/缓存 13 tests PASS（合计全量 2244 PASS）、typecheck PASS、lint PASS（0 error）。
  Task 3 详情页位置交通：amap-map-loader（点击加载 SDK、5s 超时）、AmapMapCanvas（失败兜底）、LocationPanel（地址/最近地铁/复制地址/高德外链 + POI 分类 tab）、location-pois 服务端聚合；e2e 2 passed（地图失败兜底 + 进入视口前不加载 SDK）、typecheck PASS、lint 0 error。
  注：本地 sbh_dev 曾落后 6 个 migration（0728-0731）导致 detail 页 500，已重建库 fresh migrate + seed 修复。
