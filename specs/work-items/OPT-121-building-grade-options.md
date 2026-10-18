# OPT-121 楼宇等级规范化实施计划

> 用户已确认将楼宇等级统一为超甲级、甲级、乙级、未评级，并于 2026-10-18 授权提交、CI 全绿后合并。延续当前后台改进分支，包含已完成的 OPT-120 改动；合并 master 将按仓库既定流程自动部署。

**目标：** 楼宇质量等级与创意园区、服务式办公等业态分开，后台录入、筛选、公开展示、导入与小程序采用一致口径。

**架构：** 新建独立的等级领域常量与兼容函数，规范值为 `super-grade-a`、`grade-a`、`grade-b`、`ungraded`，标签顺序为超甲级、甲级、乙级、未评级。数据库第一期扩展保留 `creative-park`、`serviced-office` 两个旧值供旧版本读写；读取侧将其与空值归为未评级，新界面不展示旧选项，保存时逐条转为规范值。使用 Payload 生成迁移，不手改迁移正文或快照。

**技术栈：** Payload 3.86、Next.js 16、PostgreSQL、pnpm 8.6.1、Vitest、微信小程序 TypeScript。

## 全局约束

- 已有甲级/超甲级保持原值；不根据业态或租金推断等级。
- 旧创意园区/服务式办公以及空等级，读取和展示为未评级。第一期迁移不批量改写存量数据，不删除历史枚举；普通编辑表单保存该字段时转换为 ungraded。
- 字段新建默认未评级，采用应用层函数默认值，避免生成 PostgreSQL 默认值对枚举类型的额外依赖。部分更新未提交 grade 时保留原有等级，非法输入继续拒绝，不能把任意字符串静默变成未评级。
- 正式下拉和筛选只给新四值；旧值保留在 schema options 的兼容项中，经过 filterOptions 隐藏；afterRead 归一后现有旧值可正常显示、保存。
- 未评级筛选必须同时命中显式 ungraded、旧两值和空值。内存筛选、SQL 分页/分面/排序、后台 Where 口径一致，排序超甲级 > 甲级 > 乙级 > 未评级。
- 返回含等级 DTO 的前台及 mini 缓存加入统一等级语义版本，避免跨重启/部署读取旧分面或旧展示值。
- 首页“创意园区”类型入口属于业态，不是 grade，本项保持其业务含义。既有 URL 标识及已批准的自动生成逻辑保持可用。
- 生成物 types/importmap 正常生成；迁移只用 `payload migrate:create`，迁移文件正文与 JSON 不手改。
- 本地数据库必须先核对环回地址，再应用已生成的非破坏性扩展迁移；不访问生产凭据。
- 文档和用户可见文案使用简体中文。

## Task 1：Payload 应用实现（实现代理 A）

文件范围：只改 payload-office-platform 内与楼宇 grade 直接相关的领域模块、Buildings 配置、前后台 consumers、导入、mini API 契约/mapper、测试与演示夹具。不改 sbh-miniprogram，不生成/执行迁移，由主代理负责。

- [x] 先写失败用例验证规范四值、旧值/空值兼容、部分更新/非法值处理、SQL与内存/后台未评级筛选、分面和排序，以及导入新标签。
- [x] 将常量和规范化集中到 `src/domain/supply/building-grade.ts`，前端旧 building-grade 模块可薄重导出维持原消费路径。
- [x] Buildings grade 的 options 使用新旧并集，defaultValue=ungraded；afterRead 归一展示、beforeValidate 仅处理该字段与新建默认、filterOptions 不出现旧业态。保持 OPT-120 的 beforeValidate hook。
- [x] 同步后台列表/筛选、前台详情事实、列表/卡片、public-catalog 内存与 SQL 查询、供给导入，禁止 domain 反向依赖组件常量。既有同类grade标签表改为共享函数，避免第三份字面量。
- [x] mini API 的等级联合类型及 mapper 输出规范四值，与 Task 2 的客户端约定相同。
- [x] 更新语义已变的测试和 dev-story 演示数据，不篡改迁移历史、真实业态入口或无关行为。
- [x] 测试先红后绿、生成 types/importmap、typecheck、lint；报告到 `artifacts/verification/OPT-121/implementation.md`。自动化全量待主代理协调，避免并发重复跑。

## Task 2：小程序客户端同步（实现代理 B）

文件范围仅 sbh-miniprogram，禁止修改 payload-office-platform、迁移或数据库。

- [x] 先用行为测试证明客户端能接收/显示乙级与未评级，筛选只输出规范四值。
- [x] 更新 `miniprogram/services/catalog-contracts.ts` 的等级取值、中文标签与解析；兼容旧服务返回的两个业态 grade 时归一为 ungraded，未知字符串仍拒绝。
- [x] 更新 `miniprogram/pages/buildings/index.ts` 的筛选选项，顺序“全部、超甲级、甲级、乙级、未评级”。
- [x] 更新受影响契约测试；运行相关测试及项目类型检查，报告 `artifacts/verification/OPT-121/miniprogram.md`。不得声称实机微信验收通过。

## Task 3：迁移与集成验证（主代理）

- [x] 只读记录本地 grade 分布、当前枚举和待迁移状态。
- [x] Task 1 完成后运行 `pnpm exec payload migrate:create opt_121_building_grade_options_expand`；核对纯生成内容只扩展 grade 枚举/默认值，无数据改写或列/表删除。
- [x] 运行 migrate:dry-run，停本地 dev 服务，在明确加载 .env.local 且关闭 jobs autoRun 的子进程中应用迁移；比较前后 grade 行值完全一致、枚举为新旧并集。
- [x] 重启 dev 服务；验证后台四选项、旧值显示未评级、新建保存乙级/未评级后刷新回显、后台未评级筛选覆盖旧/空值；用实际浏览器请求和响应取证。
- [x] 验证公开详情和列表筛选/分面，运行 PostgreSQL SQL/内存一致性测试与迁移漂移检查。
- [x] 执行 Payload 全量测试、小程序测试和类型检查、构建，完成独立审查并记录证据。已知 tar PATH 问题只在测试子进程加入 Git usr/bin 处理。
- [x] 清理本项测试草稿（软删除），保留本地服务，汇总至 `artifacts/verification/OPT-121/verification.md`。

## 回滚和范围

本期仅扩展数据库允许值，不批量回填或移除旧枚举。流量回滚不执行 down；旧版本仍可读写原值。down 仅在没有任何新等级值时才可能成功，不自动执行。待新版完全上线后再另议存量回填、移除旧值和旧客户端兼容层。小程序源代码与服务契约会同步更新，本项不发布微信版本。

**新旧客户端兼容：** URL 参数 `gradeSchema=quality-v1` 明确声明新等级能力；未声明或未知版本响应仅返回旧客户端认识的超甲级/甲级/null，乙级和未评级降为 null。适配在 HTTP 输出边界复制执行，共享缓存保持规范四值。覆盖首页、楼盘列表/详情/推荐、房源详情关联楼盘和收藏；旧业态等级筛选归一为未评级。新版小程序统一请求层追加唯一能力参数，保留其他参数与鉴权逻辑。本项不自动发布微信客户端。
