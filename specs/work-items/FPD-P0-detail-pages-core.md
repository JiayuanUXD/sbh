# Task Packet：FPD-P0 房源与楼盘详情核心

> 状态：已完成  
> 创建日期：2026-07-30  
> 最后更新：2026-07-31

## 1. 目标

完成房源详情与楼盘详情的结构化决策信息、统一有效供给、楼内分组比较、两步咨询降级、SEO、响应式与可访问性闭环。

## 2. 非目标

- 不包含 P1 地图/POI、收藏/分享增强、信息纠错及 P2 路线规划、预约时段、顾问状态。
- 不执行历史数据推断式回填，不发布生产环境。

## 3. 权威上下文

- 计划：`docs/superpowers/plans/2026-07-30-detail-pages-p0-core.md`
- 页面 PRD：FP-03 房源详情、FP-04 楼盘详情。
- 证据：`artifacts/verification/FPD-P0/README.md`

## 4. 当前行为与证据

- 验证目标提交：`35ae3b2`。
- 详情页只消费 Public Catalog DTO；有效性、推荐、聚合、咨询候选与 sitemap 复用统一供给规则。

## 5. 影响范围

- 数据模型/迁移：Listings、Buildings、Leads 咨询上下文及 Payload 生成类型。
- 前台：两个详情路由、可复用详情组件、楼内供给浏览、SEO/JSON-LD、分析事件和响应式样式。
- 风险控制：价格完整 key、PII 白名单、提交时有效性复核、legacy `listings.status` 保留。

## 6. 实施清单

- [x] 建立结构化房源/楼盘字段及显式迁移。
- [x] 建立详情 DTO、值对象、白名单 mapper 与完整价格 key。
- [x] 建立楼盘统一供给分组、筛选、排序和聚合。
- [x] 建立两步咨询、失效目标降级与隐私安全上下文。
- [x] 完成房源详情、楼盘详情、SEO、JSON-LD、埋点和响应式交互。
- [x] 在独立 PostgreSQL 空库完成 fresh replay、seed 与媒体 seed。
- [x] 完成类型、lint、全量测试、构建、四文件 E2E 与浏览器矩阵。

## 7. 验收

- 两页只消费公开 DTO，失效供给不从详情、聚合、推荐、咨询候选或 sitemap 泄漏。
- 楼内供给按租售类型、币种、周期、basis 和 display unit 独立分组，不跨单位比较。
- 房源失效提交降级到有效楼盘或通用需求，不建立错误房源关系。
- 375、768、1440、1920 四档无横向溢出，键盘、焦点、固定 CTA 和控制台验证通过。
- PostgreSQL 迁移、类型、lint、全量测试、构建和目标 E2E 通过。

## 8. 结果

- 实际结果：Tasks 1–10 完成；详情字段、公开查询、供给比较、咨询、SEO、响应式与可访问性交付。
- 迁移：专用数据库 `sbh_detail_pages_p0` fresh replay 24/24；dry-run 0 blocking；verify 109 checks / 0 fail；status 0 pending。
- 工程门禁：typecheck PASS；lint 0 errors / 9 warnings；Vitest 126 files / 2204 tests；build PASS。
- 浏览器：四文件 Playwright 无 retries 36/36；图片 error 稳定降级占位通过；房源/楼盘四档唯一 H1、`console.error` / `pageerror` 0 已固化；F7.3 alt 原子 DOM 快照 repeat 3/3。
- 详细证据与剩余风险：[FPD-P0 验证 README](../../artifacts/verification/FPD-P0/README.md)。
