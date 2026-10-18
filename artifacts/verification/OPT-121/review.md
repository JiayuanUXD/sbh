# OPT-121 独立代码审查

日期：2026-10-18。范围：当前未提交的楼宇等级规范化改动，保留此前 OPT-120 自动 URL 标识改动。

## 审查范围

已核对规范四值、旧枚举与空值兼容、Payload 字段与 hooks、后台筛选条件、公开 mapper、内存与 PostgreSQL 查询中的筛选/排序/分面、导入中文标签、mini API 输出及小程序解析/展示/筛选。已读取批准的 Task Packet、两级 CLAUDE.md 及关联领域规则。审查不修改源码、数据库和运行服务。

## 发现 1：省略 grade 的部分更新会写回规范值（已关闭）

优先级 P2。位置：`payload-office-platform/src/domain/supply/building-grade.ts:30-33`、`payload-office-platform/src/collections/Buildings.ts:373`。

当前字段 afterRead 将原始 `creative-park`、`serviced-office`、NULL 改为 `ungraded`。Payload 3.86 的实际更新管道在 collection beforeValidate 之前，先以 afterRead 构造 originalDoc，再把字段的原文档值补入没有提交的 data。因此只检查 `'grade' in data` 无法判断原请求是否提交该字段。对旧值/NULL 文档仅 PATCH 名称，也会将原始 grade 写成 ungraded，违反批准范围中“部分更新未提交 grade 时保留原有等级”。

运行时依据：

- `node_modules/payload/dist/collections/operations/utilities/update.js:44-55`：原文档先经过字段 afterRead。
- 同文件 `:90-114`：先执行字段 beforeValidate，再执行 collection beforeValidate。
- `node_modules/payload/dist/fields/hooks/beforeValidate/promise.js:230-236`：缺失字段回填原文档/默认值。

原有直接调用 normalizeBuildingGradeInput 的单测不能覆盖上述字段管道。已通知主代理和实现代理，要求增加真实 Payload 字段管道回归，并以本地测试草稿的原始 PostgreSQL grade 核验仅名称 PATCH。

## 后续发布限制

`payload-office-platform/src/domain/mini-program/mappers.ts:55-58` 现在会立即将已有 NULL/旧业态输出为 `ungraded`。旧小程序客户端的严格等级白名单不认识 `ungraded`/`grade-b`，可能拒绝整份首页、列表、详情响应。发布服务端前必须明确兼容客户端的覆盖范围，或引入明确的 API 版本/客户端能力分支。仅同时修改两端源码不能证明已发布旧客户端可继续使用。本地修改与验收不受该部署协调事项影响；本项没有部署或发布小程序。

## 其余核对结果

- 新旧六值保留在数据库枚举和字段 options 中；新下拉只给规范四值。
- SQL CASE 与内存过滤/分面/等级序位一致，未评级涵盖旧两值、NULL 和规范值。
- 后台 Where 同时查询 ungraded、旧两值、NULL。
- 前端楼盘与房源卡片、详情事实复用领域等级标签；导入接受新四个中文标签。
- 小程序卡片/详情消费共享标签，等级筛选发送新四值；旧服务返回的两个旧业态解析为未评级。
- 生成迁移只替换等级枚举类型，保留旧值，无存量行 UPDATE。未手工修改迁移正文。

## 最终复审

发现 1 已关闭。复审确认 grade 字段 beforeValidate 在 Payload 回填前用 WeakSet 记录原始 data 省略字段；collection 的等级规范化 hook 排在首项，消费记录并剔除被回填的 grade。其后字段 beforeChange 不会重填 select 值。新增 building-grade-pipeline.test.ts 使用 Payload 真实字段遍历器覆盖旧两值、NULL、正常等级以及共享 req 并发更新。主代理提供的 runtime-red.log 在修复前复现了 creative-park 被误改；runtime-results.json/runtime-green.log 的 14 项真实 REST + PostgreSQL 验证确认旧两值/NULL 的省略字段 PATCH 保留原值，显式等级保存与刷新正确，非法四类输入返回 400 且不改原值。发现 2 亦已关闭，详见下方最终结论。

## 发现 2：等级投影与分面变更没有更新持久化缓存键（已关闭）

优先级 P2。主代理浏览器现场确认 `/shanghai/buildings` 仍返回旧楼盘 slug 与旧等级分面，详情页则已显示未评级。位置：`payload-office-platform/src/lib/frontend/cached-queries.ts:278-290`，以及同文件其他保存 grade DTO 的缓存、`src/lib/mini-program/cached-queries.ts` 的领域 DTO 快照。

Next 16.2.10 的 `node_modules/next/dist/server/web/spec-extension/unstable-cache.js:53` 将 `cb.toString()` 与 keyParts 合并构造固定缓存键，`:79` 加入调用参数。被引用 mapper、等级常量或 SQL 的变更不自动参与该键。旧条目在持久化缓存保留时可被新版继续读取；过期时还会先返回旧值并后台更新。因此改 mapper 与 SQL 后只重启服务、只清本地缓存都无法保证新版首批请求采用新口径。

已要求实现代理为所有受等级 DTO 语义影响的 web/mini 缓存加入共享版本，并加入缓存键回归；主代理保留现场证据并复验。


## 最终结论

两项 P2 发现均已修复，当前审查范围无剩余阻断问题。

复审确认 Web 的 11 个含楼宇 grade DTO 缓存键与 Mini 的 4 个领域快照键均加入共享 `BUILDING_GRADE_SCHEMA_VERSION`，包括容易遗漏的区域落地页与楼盘 sitemap 摘要。原房源扫描 `ListingScanRow` 和 `LISTING_SCAN_POPULATE` 不含 grade；其 schema 无本次变更，后续卡片水合缓存已升级，无需同步升级扫描 snapshot-v4。

已核对缓存键测试注册实际 loader 的断言与 `payload-final-regression.log`：6 文件 63 项通过。已核对主代理 `check-local-pages.mjs` 的内容断言及 `page-results.json`：默认楼盘目录有未评级且使用现存新 slug；未评级筛选结果包含两条预期楼盘；Mini API 使用规范等级且无旧业态 grade。详情在内的 6 条页面/API 检查均返回 200。没有用删除本地缓存代替键版本修复。

本审查未自行运行生产数据库、服务或小程序发布。主代理仍负责最终全量测试、构建、浏览器汇总和测试草稿清理；本报告的代码审查通过不替代这些交付证据。未来上线仍须解决前述已发布旧小程序客户端的兼容切换。
