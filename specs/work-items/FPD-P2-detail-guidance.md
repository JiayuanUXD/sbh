# Task Packet：FPD-P2 房源与楼盘详情引导能力

> 状态：进行中
> 创建日期：2026-07-31
> 最后更新：2026-07-31

## 1. 目标

在 P1 稳定基础上增加用户主动触发的路线建议、可选择但待顾问确认的看房时段、平台服务状态和可解释的情境推荐。

## 2. 非目标

- 不建设实时日历锁位；预约始终为"待顾问确认"。
- 不公开个人顾问手机号、精确排班或在线轨迹，只公开平台服务状态。
- 不建立跨会话用户画像；推荐只用当前页面与显式筛选。
- 不接入高德以外的地图/路线供应商。

## 3. 权威上下文

- 计划：`docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md`
- 依赖：P0（详情核心）、P1（地图/POI、媒体、分享收藏、纠错）均已合并 master。
- 证据：`artifacts/verification/FPD-P2/README.md`（Task 6 产出）。

## 4. 隐私与安全边界（常驻约束）

- 用户定位只能在点击"查看到这里的路线"后读取一次；拒绝/超时/不支持回退外部导航。
- 原始用户坐标不持久化、不写日志、不进入埋点、不写 Lead。
- 路线摘要响应白名单：只返回 mode/时长/距离/换乘/来源，不含原始起点。
- 前台只显示平台服务状态；预约时段永远 `pending-confirmation`，服务端复核有效性。
- 推荐输出 `reasonCodes`，确定性打分，不读 cookie/localStorage/用户 ID/Lead。

## 5. 影响范围

- 领域：`domain/location-services`（新增路线契约/provider）、`domain/advisor-availability`（服务时段）、`domain/inquiry`（看房时段）、`domain/recommendation`（推荐）。
- 数据模型/迁移：新增 `AdvisorServiceHours` global（Task 3）、Lead 增 `ViewingPreference`（Task 4）。
- 前台：RoutePlanner、AdvisorAvailability、ViewingSlotPicker、RecommendationReason；LocationPanel/InquiryModal/ListingCard/两详情路由接入。
- API：新增 `POST /api/routes`（隐私安全代理）；扩展 `/api/inquiries`。

## 6. 实施清单

- [ ] Task 1：建立 P2 任务包和路线隐私契约（`routes.ts` / `contracts.ts` / `index.ts`）。
- [ ] Task 2：实现用户主动触发的路线建议（`RoutePlanner` + `/api/routes`）。
- [ ] Task 3：建立平台服务时间和公开状态（`AdvisorServiceHours` global + `resolveServiceStatus`）。
- [ ] Task 4：增加待确认看房时段（`viewing-slots` + Lead `ViewingPreference`）。
- [ ] Task 5：实现可解释情境推荐（`rankDetailRecommendations` + `reasonCodes`）。
- [ ] Task 6：P2 全量验证和证据。

## 7. 验证结果

（Task 6 填充）
