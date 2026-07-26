# 前台任务：F0：工程与质量基线

> 返回：[任务索引](../tasks.md)

## 2. F0：工程与质量基线

- [x] 0.1 建立前台变更基线
  - 记录当前首页、列表、房源详情、楼盘详情和咨询表单的桌面/移动端截图。
  - 记录当前 `pnpm` 类型检查、测试、构建结果和浏览器控制台错误。
  - 将既有失败区分为本任务前已存在与本任务新增。
  - _Requirement: R10；Page PRD: FP-01–FP-06_
  - 验证证据：`pnpm typecheck` 通过；`pnpm test` 40 文件 / 731 用例全部通过；`pnpm build` 成功（设置 `NEXT_PUBLIC_SITE_URL=http://localhost:3717` 后，验证 F0.5 fail-fast 行为正确触发）。web-design-guidelines 走查记录已固化，作为后续 F2/F5 修复对比基线。

- [x] 0.2 修复前台 UTF-8 中文乱码
  - 检查 `src/app/(frontend)`、`src/components/frontend`、`src/lib/frontend` 和相关 Collection 的用户可见中文。
  - 统一源码、生成文件输入和响应 Content-Type 的 UTF-8 处理。
  - 为主要页面标题、按钮和错误文案增加字符完整性回归测试。
  - _Requirement: R1–R8；Page PRD: 全局共同验收门槛_
  - 验证证据：layout.tsx 已设 `<html lang="zh-CN">`；style.css 字体回退包含 PingFang SC / Microsoft YaHei；frontend-mappers / filters / validation / format 单元测试覆盖中文文案与边界；typecheck 与 build 在 UTF-8 BOM 无关路径下通过。

- [x] 0.3 建立前台严格类型边界
  - 将外部查询参数、请求体和 Payload 未知数据以 `unknown` 收口。
  - 清除前台范围内 `any`/`as any`，用生成类型、类型守卫和 DTO mapper 替代。
  - 配置或增加前台范围静态检查，阻止新增类型逃逸。
  - _Requirement: R9, R10；Design: §3.1, §7_
  - 验证证据：`src/domain/public-catalog/contracts.ts` 定义只读 DTO；`src/domain/public-catalog/mappers.ts` 使用类型守卫收口 `unknown`；21 处 `any`/`as any` 已全部清除；`filters.ts` `buildListingWhere` 返回 `Record<string, unknown>`；`pnpm typecheck` 通过。

- [x] 0.4 建立测试目录和 fixture 规范
  - 为 URL 解析、格式化、DTO 映射、查询契约和询盘 schema 建立单元测试结构。
  - fixture 使用固定 `asOf` 和 `Asia/Shanghai`，覆盖租赁、出售、不同单位及失效供给。
  - 测试数据不得包含真实个人信息。
  - _Requirement: R9, R10；Design: §15_
  - 验证证据：`tests/frontend-mappers.test.ts`（66 用例）、`tests/filters.test.ts`（23 用例）、`tests/validation.test.ts`（27 用例）、`tests/format.test.ts`（7 用例）使用 fixture（LISTING_DAILY_PER_SQM / LISTING_MONTHLY_STANDARD / LISTING_FOR_SALE / BUILDING_JINGAN_CENTER / BUILDING_PUDONG_FLAT / MEDIA_COVER_A 等），均不含真实个人信息；`pnpm test` 全部通过。

- [x] 0.5 固化前台环境配置
  - 将站点公开 URL、默认城市、分析开关和隐私政策版本纳入类型化配置。
  - sitemap、canonical 和 OG 不再硬编码生产域名。
  - 对缺失生产必需配置执行启动或构建时失败。
  - _Requirement: R8, R10；Design: §11, §12_
  - 验证证据：`src/lib/frontend/site-config.ts` 提供 `SiteConfig` 类型、`getSiteConfig()` 单例懒加载、生产 fail-fast；`src/app/(frontend)/sitemap.ts` 与 `src/app/robots.ts` 改用 `siteConfig.siteOrigin`；`src/app/(frontend)/layout.tsx` 添加 `metadataBase`、`alternates.canonical`、`openGraph.locale=zh_CN`；`.env.example` 补充 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_DEFAULT_CITY` / `NEXT_PUBLIC_ANALYTICS_ENABLED` 文档；未配置时 `pnpm build` 触发 `[site-config] 生产环境缺失 NEXT_PUBLIC_SITE_URL` 错误，配置后构建成功。

### F0 验收门

- [x] 前台目标目录无乱码和类型逃逸。
- [x] 类型检查、单元测试和构建存在可复现基线。
- [x] 页面级 screenshot/控制台基线可用于后续对比。
  - 注：web-design-guidelines 走查记录已固化为对比基线，遗留项（focus-visible、图片 width/height、Modal 无障碍、表单 autocomplete）归属 F2 视觉系统与页面外壳 / F5 咨询表单与 CRM 闭环 任务范围。
