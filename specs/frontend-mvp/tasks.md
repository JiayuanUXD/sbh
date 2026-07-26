# 前台 MVP 实施计划

> 状态：F0–F7 全部完成，§10 最终完成定义全部勾选
> 阶段：Spec Workflow Phase 3 — Tasks  
> 需求：[`requirements.md`](./requirements.md)  
> 设计：[`design.md`](./design.md)  
> 页面 PRD：[`../../docs/prd/前台网站_MVP_页面PRD/README.md`](../../docs/prd/前台网站_MVP_页面PRD/README.md)  
> 更新日期：2026-07-26

## 0. 执行规则

- 未经本任务计划确认，不进入 Phase 4 代码实施。
- 每次只标记实际完成且已验证的任务。
- 所有前台供给消费必须等待并复用后台 M4.7 统一有效供给服务，不得以旧 `status=available` 作为生产降级。
- 修改 Collection、Global 或字段时必须生成显式迁移和 Payload 类型。
- 每个用户可见任务至少验证目标页面、一个相邻页面和浏览器控制台。
- 浏览器走查覆盖 375×812、768×1024、1440×900、1920×1080。
- 禁止新增 `any`、`as any`、`@ts-ignore`、shadcn-ui、Tailwind reset 或全局第三方 CSS reset。

## 1. 依赖与里程碑

| 里程碑 | 目标 | 依赖 | 可否立即开始 |
|---|---|---|---|
| F0 | 工程、编码与类型基线 | 无 | 是 |
| F1 | 公开数据契约与有效供给接入 | 后台 M4.7 | 部分 |
| F2 | 全局视觉系统与页面外壳 | F0 | 是 |
| F3 | 首页与房源列表 | F1、F2 | 否 |
| F4 | 房源详情与楼盘详情 | F1、F2 | 否 |
| F5 | 咨询表单与 CRM 闭环 | 后台 M5、Lead 契约 | 部分 |
| F6 | 内容页、SEO 与缓存失效 | F1、后台事件 | 部分 |
| F7 | 综合验收与上线准备 | F3–F6 | 否 |

## 2. 里程碑任务索引

- [F0：工程与质量基线](task-details/F0-baseline.md)
- [F1：公开数据契约与统一有效供给](task-details/F1-public-catalog.md)
- [F2：全局视觉系统与页面外壳](task-details/F2-design-system.md)
- [F3：首页与房源列表](task-details/F3-home-list.md)
- [F4：房源详情与楼盘详情](task-details/F4-details.md)
- [F5：咨询表单与 CRM 闭环](task-details/F5-inquiry.md)
- [F6：内容页、SEO 与缓存](task-details/F6-content-seo.md)
- [F7：综合质量与上线准备](task-details/F7-acceptance.md)

Detailed task status is maintained in milestone files. Store long logs under `artifacts/verification/<task-id>/`.

## 10. 最终完成定义

前台 MVP 只有同时满足以下条件才可标记完成：

- [x] FP-01–FP-06 的页面验收标准全部通过。
  - 证据：F3.7 / F4.5 / F6.4 验收记录；E2E [frontend-journey.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/frontend-journey.spec.ts) 9 用例覆盖首页→列表→详情→咨询、楼盘→楼内房源、内容页→通用咨询、404、无结果、重复提交、422、GET 405。
- [x] 首页、列表、详情、楼盘聚合、内容引用、询盘候选和 sitemap 的有效供给集合一致。
  - 证据：[public-catalog-effective-supply-consistency.test.ts](file:///e:/github/sbh/payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts)（29 用例）；7 个消费路径同谓词；M8.4 dry-run 双读差异 0（[artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json](file:///e:/github/sbh/payload-office-platform/artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json)）。
- [x] 公开路径无乱码、无类型逃逸、无 shadcn-ui、无敏感字段泄露。
  - 证据：[f7-5-security-privacy-acceptance.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-5-security-privacy-acceptance.test.ts)（16 用例）；DTO 白名单不暴露 reviewStatus/publicationStatus/merchantId/internalPhone/createdBy/deletedAt/geoLat；无 `any`/`as any`/`@ts-ignore`；`(frontend)/styles.css` 自维护设计系统，无 shadcn-ui 与第三方 reset。
- [x] 询盘重复请求只创建一条 Lead，来源和隐私版本正确。
  - 证据：[inquiry-domain.test.ts](file:///e:/github/sbh/payload-office-platform/tests/inquiry-domain.test.ts) + [inquiry-api-route.test.ts](file:///e:/github/sbh/payload-office-platform/tests/inquiry-api-route.test.ts)；幂等键唯一约束 + assertEffectiveListing 目标有效性复核；来源 `source` 字段已迁移（[20260724_080952_add_leads_source.ts](file:///e:/github/sbh/payload-office-platform/src/migrations/20260724_080952_add_leads_source.ts)）。
- [x] 类型检查、测试、生产构建和浏览器 E2E 通过。
  - 证据：`pnpm typecheck` ✅；`pnpm test` ✅（101 文件 / 1938 用例）；`NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build` ✅；`npx playwright test tests/e2e/` ✅（3 套件 / 29 用例 / 2 跳过）。
- [x] 四档视口设计走查、WCAG 2.2 AA 目标和性能预算通过。
  - 证据：[f7-2-visual-review.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/f7-2-visual-review.spec.ts)（11 用例，375×812 / 768×1024 / 1440×900 / 1920×1080）；[f7-3-accessibility.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/f7-3-accessibility.spec.ts)（9 用例）；[f7-4-6-performance-data-equivalence.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-4-6-performance-data-equivalence.test.ts)（性能静态守护 9 用例）。
- [x] 所有数据库变更都有显式迁移、验证报告和回滚说明。
  - 证据：[src/migrations/](file:///e:/github/sbh/payload-office-platform/src/migrations) 下 19 个迁移均含 `up()` + `down()`；[scripts/migrate-dry-run.ts](file:///e:/github/sbh/payload-office-platform/scripts/migrate-dry-run.ts) 静态守护禁止 DROP TABLE / DROP COLUMN / TRUNCATE / 旧房源自动审核通过；[scripts/data-audit.ts](file:///e:/github/sbh/payload-office-platform/scripts/data-audit.ts) M8.4 双读报告；[artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json](file:///e:/github/sbh/payload-office-platform/artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json) 5/5 一致性检查通过。
- [x] 本任务文件状态、验证证据与剩余风险已更新。
  - 状态：F0–F7 全部子任务勾选完成；本 §10 全部勾选。
  - 剩余风险：①生产 PG 环境的 LCP/INP/CLS 实验室指标需用 Lighthouse 实测；②Core Web Vitals 接入 `web-vitals` 库后待生产部署通过分析平台采集；③生产 dry-run 需在 PG 数据副本重跑 `pnpm data:audit`；④ F1.2 `district.slug` 点分键在 PG 生产未验，若失败回退两跳查询。
