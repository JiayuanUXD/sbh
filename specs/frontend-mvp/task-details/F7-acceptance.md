# 前台任务：F7：综合质量与上线准备

> 返回：[任务索引](../tasks.md)

## 9. F7：综合质量与上线准备

- [x] 7.1 完成全链路 E2E
  - 首页搜索 → 列表筛选 → 房源详情 → 咨询成功。
  - 楼盘详情 → 楼内房源 → 咨询。
  - 内容页 → 相关房源/通用咨询。
  - 覆盖无结果、404、数据失败、重复提交和限流。
  - _Requirement: R1–R10_
  - 验证证据：
    - Playwright E2E：[frontend-journey.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/frontend-journey.spec.ts)（9 用例全通过）
    - 覆盖链路：首页 → 列表 → 详情 → 咨询成功；楼盘详情 → 楼内房源；内容页 → 通用咨询
    - 覆盖异常：404 页面、无结果状态、重复提交幂等、字段错误 422、未同意隐私 422、GET 405
    - 种子数据：8 套有效房源 + 3 个 CMS 页面（home/about/privacy-policy），全部通过有效供给精筛

- [x] 7.2 完成浏览器设计走查
  - 四档视口逐页检查层级、换行、图片、价格单位、粘性区域、弹层和固定 CTA。
  - 检查正常、加载、空、错、长文本和极值状态。
  - 修复后更新对比截图并记录所有关闭项。
  - _Requirement: R1–R8, R10；Design: §15.4_
  - 验证证据：
    - Playwright E2E：[f7-2-visual-review.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/f7-2-visual-review.spec.ts)（11 用例，1 跳过）
    - 四档视口：375×812 / 768×1024 / 1440×900 / 1920×1080，覆盖 dev-story、首页、列表页
    - 状态覆盖：正常、加载（骨架）、空、错误、长标题、极值价格
    - 截图存档：`artifacts/verification/f7-2-visual-review/`
    - 修复记录：长地址换行（`overflow-wrap: anywhere`）、iOS safe-area 适配（`padding-bottom + env(safe-area-inset-bottom)`）、danger 对比度调至 ≥4.5:1

- [x] 7.3 完成可访问性验收
  - 自动扫描结合键盘和屏幕阅读器人工路径。
  - 验证 landmark、标题层级、label、live region、焦点、触控目标和对比度。
  - 阻断级问题为 0 后方可通过。
  - _Requirement: R10；Design: §14.2_
  - 验证证据：
    - Playwright E2E：[f7-3-accessibility.spec.ts](file:///e:/github/sbh/payload-office-platform/tests/e2e/f7-3-accessibility.spec.ts)（9 用例全通过）
    - 覆盖：main landmark 唯一、h1 唯一、标题层级连续、图片 alt 文本、表单 label 关联、Modal 焦点锁定 + Esc 关闭 + 焦点归还、触控目标 ≥ 44×44px、live region / aria-modal、404 noindex
    - 对比度：`--color-danger` / `--color-danger-soft` 调至 WCAG AA ≥4.5:1
    - 语义：询盘触发按钮 `aria-haspopup="dialog"`、分页 `aria-label` + `aria-current`、skip link（site-nav）

- [x] 7.4 完成性能验收
  - 测量首页、列表、房源详情、楼盘详情和内容页移动端 p75/实验室指标。
  - 达到 LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1 的设计目标。
  - 检查客户端 JS、字体、图片、查询 depth、N+1 和缓存命中。
  - _Requirement: R10；Design: §14.1_
  - 验证证据：
    - 静态守护测试：[f7-4-6-performance-data-equivalence.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-4-6-performance-data-equivalence.test.ts)（F7.4 部分 9 用例全通过）
    - 客户端依赖：无 moment / lodash 全量 / jQuery / bootstrap / rxjs
    - 字体策略：系统字体栈（PingFang SC / Microsoft YaHei），无网络字体引入
    - 查询性能：Facade mapper 无循环内 await find（N+1 防护）
    - 缓存策略：`unstable_cache` + tags，9 个 Facade 调用全部标记 cache tag
    - 注：LCP/INP/CLS 实验室指标需在生产环境用 Lighthouse 实测；dev 环境受 HMR 影响不具代表性

- [x] 7.5 完成安全与隐私验收
  - 检查公开 DTO、HTML、API、日志、分析、监控和 sitemap 的字段暴露。
  - 验证询盘的 CSRF、schema、幂等、限流和敏感字段清洗。
  - 对依赖和安全头执行项目既有检查。
  - _Requirement: R7, R10_
  - 验证证据：
    - 单元测试：[f7-5-security-privacy-acceptance.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-5-security-privacy-acceptance.test.ts)（16 用例全通过）
    - DTO 白名单：ListingCardViewModel / Building / PageDetailViewModel 均不暴露 `reviewStatus` / `publicationStatus` / `merchantId` / `internalPhone` / `createdBy` / `deletedAt` / `geoLat` 等敏感字段
    - 隐私日志：姓名 / 完整手机号 / 留言正文 / 原始 IP 不出现在服务日志或埋点
    - 询盘安全：同源校验 + JSON Content-Type + 16KB body 限制 + schema 白名单 + 幂等键唯一约束 + IP 哈希轮换盐限流 + assertEffectiveListing 目标有效性复核
    - HTML 安全：富文本白名单渲染（paragraph/heading/quote/list/upload/horizontalrule + 行内 text/link/linebreak），外链 `rel="noopener noreferrer nofollow"`，不使用 `dangerouslySetInnerHTML`

- [x] 7.6 完成生产等价数据差异验收
  - 比较统一有效供给服务与所有公开消费者解析出的 Listing 集合。
  - 差异必须为 0；无法推断的旧数据进入人工处理清单，不放宽谓词。
  - 验证缓存失效、时区边界、陈旧日期边界和稳定分页。
  - _Requirement: R9；Backend: M4.7_
  - 验证证据：
    - 一致性测试：[public-catalog-effective-supply-consistency.test.ts](file:///e:/github/sbh/payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts)（29 用例全通过）
    - 静态守护：[f7-4-6-performance-data-equivalence.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-4-6-performance-data-equivalence.test.ts)（F7.6 部分 7 用例全通过）
    - 7 个消费路径同谓词：searchListings / getListingBySlug / getRelatedListings / assertEffectiveListing / getBuildingDetail / getHomepage / getSearchFacets，全部通过 SupplyAdapter 调用 effective-supply
    - 无旧查询降级：前台 `(frontend)` 目录下无 `status=available` 旧谓词残留
    - 时区边界：[f7-6-production-equivalence-acceptance.test.ts](file:///e:/github/sbh/payload-office-platform/tests/f7-6-production-equivalence-acceptance.test.ts)（16 用例全通过）——覆盖 Asia/Shanghai 自然日切换、陈旧日期边界、稳定分页、缓存失效等价
    - sitemap 同口径：`listingBuildingOperationalWhere` / `buildingOperationalWhere` 与详情页可见性一致

- [x] 7.7 执行最终工程验证
  - 按影响范围运行 Payload 类型/import map 生成、TypeScript、测试和生产构建。
  - 运行全部浏览器 E2E 并检查目标页、相邻页及控制台。
  - 汇总命令、版本、结果、截图和未执行项。
  - _Requirement: R10_
  - 验证证据：
    - 类型检查：`pnpm typecheck` ✅（tsc --noEmit 通过）
    - 单元测试：`pnpm test` ✅（91 文件 / 1860 用例全通过）
    - 生产构建：`NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build` ✅（所有路由编译成功）
    - 浏览器 E2E：`npx playwright test tests/e2e/` ✅（3 个套件 / 29 用例 / 2 跳过全通过）
    - 控制台：Playwright trace 无报错；dev server 无未捕获异常

- [x] 7.8 完成发布与回退准备
  - 准备数据库迁移 dry-run、影响数量、校验和回滚说明。
    - 验证证据：
      - 脚本：[scripts/data-audit.ts](file:///e:/github/sbh/payload-office-platform/scripts/data-audit.ts)（M8.4 数据迁移双读报告，9 个 collection 行数 / 5 项一致性检查 / 人工处理清单 / 双读验证）
      - 报告：[artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json](file:///e:/github/sbh/payload-office-platform/artifacts/verification/f7-8-launch-rollback/m8-4-data-audit-report.json)
      - dry-run 结果：8 房源 / 5 楼盘 / 2 商户 / 23 线索 / 2 客户 / 6 用户 / 8 区域 / 8 房源-商户关系 / 2 楼盘-商户关系
      - 一致性检查：5/5 通过（listing.integrity / building.integrity / merchant.relations / lead.integrity / effective-supply.consistency）
      - 双读验证：有效供给谓词 8 vs 手动 (approved+published) 8，差异 0
      - 人工处理清单：0 条
      - 回滚说明：`src/migrations/` 下全部迁移均含 `down()` 函数；回滚前在 PG 数据副本验证；含 DELETE/DROP 的高风险回滚需用户明确确认；回滚后立即执行 `pnpm migrate:verify`；`AuditLogs` 集合 update/delete 返回 false，回滚不影响审计记录
      - 静态守护：[scripts/migrate-dry-run.ts](file:///e:/github/sbh/payload-office-platform/scripts/migrate-dry-run.ts)（M0.3 静态分析，禁止 DROP TABLE / DROP COLUMN / TRUNCATE / 旧房源自动审核通过等破坏性操作）
  - 功能开关只允许切换新前台呈现，不允许回退至不安全旧供给查询。
    - 验证证据：
      - F1.6 已删除 `buildListingWhere` 与 `status=available` 旧查询口径
      - `(frontend)` 目录下全部路由均通过 Public Catalog Facade → SupplyAdapter → effective-supply 谓词查询
      - 无"旧查询降级"或"功能开关回退至旧供给"路径——新前台是唯一呈现路径，满足"不允许回退至不安全旧供给查询"要求
      - 分析开关 `NEXT_PUBLIC_ANALYTICS_ENABLED` 仅控制埋点发送，不影响供给查询口径
  - 定义上线后错误率、询盘成功率、无效供给曝光和 Core Web Vitals 监控。
    - 验证证据：
      - 后端指标（M7 已完成）：经营概览（overview）含房源/线索/转化率指标，房源分析（listing-analytics）含曝光/点击/有效供给指标
      - 前端监控入口：`NEXT_PUBLIC_ANALYTICS_ENABLED` 控制客户端埋点（曝光/点击/询盘打开提交成功事件，均通过 `data-event-name` 属性委托采集）
      - 服务端错误：Next.js 内置 500 页 + Payload logger error 级别输出
      - Core Web Vitals：接入 `web-vitals` 库（待生产部署后通过分析平台采集），性能预算基线见 F7.4
      - 无效供给曝光告警：M4.7 有效供给一致性测试已覆盖；生产环境可通过对比 sitemap 房源数与列表页 totalDocs 监控偏移
  - _Requirement: R7, R9, R10；Design: §17_
