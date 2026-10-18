# OPT-121 Payload 应用实现证据

本报告仅覆盖 Task 1。实现保留当前分支已有 OPT-120 自动 URL 标识改动；没有操作服务、数据库、迁移、提交、推送、PR 或部署。浏览器、PostgreSQL 与全量集成由主代理执行。

## 实现

- `src/domain/supply/building-grade.ts` 是等级顺序、标签、规范值、旧值兼容、后台 Where 的事实源。规范值按超甲级、甲级、乙级、未评级排列。组件旧路径只作薄重导出；供给导入直接依赖领域模块。
- Buildings schema 保留新四值与旧两值的并集。`filterOptions` 只给四个规范值，字段 `afterRead` 把旧两值、null 与缺失归为未评级。保存前仅转换本次提交的 grade；新建默认未评级；保留 OPT-120 的 `ensureBuildingSlug` 链。真实 Payload 的字段 beforeValidate 会先把 afterRead 后的 originalDoc 值补入 data，因此新增字段 hook 在补入前以 WeakSet 记录省略 grade 的原 data；collection 归一 hook 调整为第一项，在其它 hook 复制 data 前消费标记并删除补入的 grade，最终存储更新自然省略该字段。标记按输入对象隔离，不使用共享 req/context。
- 原生 Payload select 仅能完整检查字符串/数组，单独使用它可能接受 number/object 等非字符串输入，因此添加 grade 字段校验：无法识别的输入返回中文错误。未知输入在保存前保持原样，不会默默改成未评级。
- 前台 summary/detail、详情事实、ListingCard、后台列表复用共享归一和标签；等级筛选与内存分面将旧值/null归并到 ungraded。SQL 投影先按同一规则转换，再统一进行筛选、排序与分面；旧枚举通过绑定共享常量传入 SQL。
- 后台未评级 Where 同时查 `ungraded`、旧两值和 `exists:false`，保留尚未回填的行。空字符串作为表单空值读写归一；数据库 grade 枚举不允许存储空字符串。
- mini API 契约只输出规范四值，卡片与详情 mapper 对旧值和空值输出 ungraded。供给导入接受四个新标签，拒绝旧业态标签。导入空列继续沿用原有 null/清空语义，经保存钩子转为 ungraded。
- 更新语义变化的排序测试、OPT-120 新建缺名称测试中新增默认 grade 的预期，以及 dev-story/seed 演示等级。首页创意园区入口属于业态，没有修改。
- 领域模块定义 `BUILDING_GRADE_SCHEMA_VERSION`，追加到全部含等级 DTO 的 Web 与 Mini 缓存 keyParts（包含首页、详情、楼盘搜索、相关推荐、房源卡片、楼盘 sitemap 页与区域落地页）。Next 缓存不自动将被引用 mapper 的变化计入键，显式语义版本确保已有旧值缓存立即隔离；未手清本地缓存。

## 与计划的实现细节

主代理在迁移生成后复现了静态数据库 DEFAULT 对自动 down 枚举删除的依赖错误。字段因此使用 `defaultValue: () => 'ungraded'`，保持应用新建默认值，同时避免生成数据库 DEFAULT。测试核对该函数实际返回 ungraded；迁移由主代理重新纯生成，未手改正文。

## 基线与红绿

| 阶段 | 命令 | 结果 | 输出 |
| --- | --- | --- | --- |
| 基线 | `pnpm exec vitest run tests/opt036-building-search-result.test.ts tests/supply-import-building-row.test.ts` | 2 文件，49 通过 | `payload-baseline.log` |
| 第一轮红 | `pnpm exec vitest run tests/building-grade.test.ts` | 4 条行为断言失败：选项、解析、筛选排序、mapper/分面 | `payload-red.log` |
| 第一轮绿 | 同上 | 4 条通过 | `payload-green-first.log` |
| 非字符串校验红 | 同上（补充字段与 mini 测试后） | 1 失败、12 通过：grade 尚未定义显式 validate | `payload-red-validation.log` |
| 实际字段管道红 | `pnpm exec vitest run tests/building-grade-pipeline.test.ts` | 8 失败、6 通过：未提交字段仍被 Payload 补入 | `payload-pipeline-red.log` |
| 实际字段管道绿 | 同文件及 building-grade/building-slug | 3 文件，46 通过 | `payload-pipeline-green.log` |
| 缓存红 | `pnpm exec vitest run tests/public-catalog-city-cache.test.ts tests/mini-api-cached-queries.test.ts` | 2 失败、10 通过：缓存键没有等级语义版本 | `payload-cache-red.log` |
| 收尾增量绿 | 缓存两文件、public-cache-tag-scope 与 grade/pipeline/slug 三文件 | 6 文件，63 通过 | `payload-final-regression.log` |
| 旧导航合同同步 | `pnpm exec vitest run tests/buildings-navigation-performance-contract.test.ts` | 2 通过；保留资源键/城市/统一版本、楼盘/facet tags及300秒约束；解析正则兼容LF/CRLF | `payload-navigation-contract.log` |
| 缓存作用域夹具隔离 | Node 22.22.2：`pnpm exec vitest run tests/public-cache-tag-scope.test.ts` | 5 通过；总时长731ms，测试36ms | `payload-cache-scope-node22-green.log` |
| 最终绿 | 下列目标命令 | 10 文件，283 通过，退出码 0 | `payload-targeted-green.log` |
| 类型 | `pnpm typecheck` | 退出码 0 | `payload-typecheck.log` |
| 收尾类型 | `pnpm typecheck`（WeakSet与缓存版本后） | 退出码 0 | `payload-final-typecheck.log` |
| 定向 lint | `pnpm exec eslint` 检查本项代码、测试和演示夹具 | 退出码 0，无输出 | `payload-lint.log` |
| 收尾 lint | 字段/领域、Web/Mini缓存及管道/缓存测试 | 退出码 0，无输出 | `payload-final-lint.log` |
| 生成类型 | `pnpm generate:types` | 成功 | `generate-types.log` |
| 生成 importmap | `pnpm generate:importmap` | 无新增 imports，正常退出 | `generate-importmap.log` |

最终目标命令：

```powershell
pnpm exec vitest run tests/building-grade.test.ts tests/opt036-building-search-result.test.ts tests/supply-import-building-row.test.ts tests/mini-api-mappers.test.ts tests/frontend-mappers.test.ts tests/building-slug.test.ts tests/building-form-layout.test.ts tests/building-filter-rows.test.ts tests/mini-api-building-catalog-service.test.ts tests/opt115-building-type-legacy.test.ts
```

证据均位于本报告同目录。`grade-consumers.txt` 为实现时搜索清单，包含历史迁移命中；历史迁移未改。中间运行发现的旧测试预期差异见 `payload-targeted-initial.log`。本机命令环境为 Node 24.14.0、pnpm 8.6.1，会有仓库要求 Node 22 的 engine 警告；上述测试/类型命令仍正常退出。

主代理最终全量运行发现缓存作用域测试在 Node22 的 beforeAll 发生10秒初始化超时。该测试只观察 `unstable_cache` 注册，原本动态导入 sitemap-shards 却连带初始化未执行回调使用的路由模块图。仅在该测试 mock `city-context.listPublicCityProfiles` 与 `sitemap.globalStaticUrls` 两个回调专用依赖，保留真实 sitemap-shards、缓存注册、全部5项断言与原时限；Node22定向复跑5/5通过。未调高超时或跳过测试。全量原始失败日志由主代理保留，不将定向回归误称为重新全量通过。

## 待集成验证

已扩展 `tests/building-query-postgres.test.ts` 的真实 SQL/内存一致性矩阵：新四值、旧两值、NULL、ungraded单选/多选/排序/年代组合。代码单测验证后台 Where 结构。主代理负责隔离本地库、后台真实 NULL 命中、表单抓包、刷新回显、深色展开态与公开页面；这些集成结果以主代理最终 `verification.md` 为准。主代理已报告部分更新真实 REST/PG 先红后绿，证据为同目录 `runtime-red.log`、`runtime-green.log` 与 `runtime-results.json`。

## Mini 旧客户端发布阻断的修复

原先 mini v1 直接输出 canonical 四值，会被尚未更新的严格枚举客户端拒绝。现已用明确 URL query `gradeSchema=quality-v1` 做能力协商：只有精确声明该值才输出四个规范等级；未声明或未知版本只输出旧客户端认识的 `super-grade-a`、`grade-a` 与 null，`grade-b`/`ungraded` 降级为 null。旧 `creative-park`/`serviced-office` 筛选在服务入口转换为规范 ungraded 查询，不会因解析器丢弃而变成无条件查询。

新增 `src/domain/mini-program/grade-schema.ts` 的类型安全响应适配，覆盖首页 featuredBuildings、楼盘 items/inactiveItems、楼盘详情与 comparableBuildings、房源详情 buildingInfo，以及 `/me` 收藏楼盘。领域 mapper、用户资产投影和所有共享缓存始终保存 canonical 数据；五个 HTTP 输出边界在缓存外复制适配，旧/新/未知请求交替不会改写共享快照。明确 query 也让 HTTP/CDN URL 地址分离，不依赖遗漏风险较高的 Vary。新增客户端由主代理统一在请求层追加能力 query。

先红证据：Node22 下三个文件 7 失败、10 通过，捕捉旧/未知请求枚举泄漏、旧筛选丢弃、收藏返回新枚举，见 `mini-grade-negotiation-red.log`。修复后 Node22 九文件 86 全部通过，包含旧/新/未知 schema、五条输出边界、canonical 快照新旧交替不污染、真实用户资产投影与旧筛选兼容，见 `mini-grade-negotiation-green.log`。目标 eslint 退出0，见 `mini-grade-negotiation-lint.log`；Node22 类型检查退出0，见 `mini-grade-negotiation-typecheck.log`。该兼容阻断的代码修复已具备回归证据，最终发布仍由主代理审查并执行。
