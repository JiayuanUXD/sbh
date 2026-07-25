# Payload 平台根级 Agent 指南

本文件适用于 `payload-office-platform/` 目录及其所有子目录。它约束参与商办租赁平台开发的 Codex、Claude、自动化 Agent 和人工开发者。

本文件只保存长期有效的工程与业务约束。具体需求、技术设计和任务进度必须引用权威文档，不要复制后形成多套事实来源。

涉及 C 端公开站、公开查询、SEO、咨询表单或前台浏览器验收的任务，还必须读取并遵守 [`FRONTEND_AGENT.md`](./FRONTEND_AGENT.md)。该文件是前台开发专项约束；发生冲突时，不得放宽本文件中的后台业务不变量、权限、迁移和数据安全规则。

## 1. 项目与技术栈

- 应用：商办租赁平台，包含 Payload 后台、Payload API 和 C 端公开站。
- 框架：Next.js 16 App Router。
- CMS：Payload CMS 3.86。
- UI：React 19；后台以 Payload 原生组件和表单为主，Arco Design 仅用于有明确收益的 Dashboard、图表和复杂操作区。
- 富文本：Payload Lexical。
- 包管理器：pnpm，遵循 `packageManager` 声明；不得使用 npm 或 yarn 改写锁文件。
- 本地数据库：SQLite。
- 生产数据库：PostgreSQL。
- 媒体：当前使用 Payload 本地上传；S3 插件已卸载，不得假设 `@payloadcms/storage-s3` 仍存在。
- 默认文档语言：简体中文。

## 2. 权威文档与优先级

开发前按以下顺序阅读和解释需求：

1. `../docs/prd/后台管理系统_MVP_页面PRD/README.md`
2. `../docs/prd/后台管理系统_MVP_页面PRD/` 下对应页面 PRD
3. `../specs/backend-mvp/requirements.md`
4. `../specs/backend-mvp/design.md`
5. `../specs/backend-mvp/tasks.md`
6. 本文件
7. 代码中的局部注释和旧计划

规则：

- 页面 PRD 索引和 22 份页面 PRD 是当前 MVP 产品验收基线。
- `../docs/prd/后台管理系统_MVP_PRD.md` 是旧版汇总文档，仅用于理解演进背景；发生冲突时不得覆盖页面 PRD。
- `tasks.md` 描述实施顺序，不得修改上层需求含义。
- 发现文档冲突时停止相关实现，列出冲突字段、页面和影响范围，等待产品确认。

## 3. 当前实施阶段

- 完整计划位于 `../specs/backend-mvp/tasks.md`。
- 未经用户明确批准，不得跨越当前获批里程碑提前实施后续业务模型。
- 每次开始任务前，确认任务编号、对应 Requirement、前置依赖和验收门。
- 完成任务后更新 `tasks.md` 中对应复选框；只标记实际完成且已验证的项。
- 当前建议起点是 M0：工程、迁移和测试基线。

## 4. 目录职责

```text
src/
├── app/
│   ├── (frontend)/       # C 端公开站
│   └── (payload)/        # Payload Admin 和 Payload API
├── collections/          # Payload Collection 配置
├── components/
│   ├── admin/            # 后台 Custom Components / Widgets
│   └── frontend/         # C 端组件
├── domain/               # 后续领域服务，按 design.md 划分
├── lib/
│   └── frontend/         # C 端查询、筛选、格式化、校验
├── migrations/           # Payload 显式迁移
└── payload.config.ts
```

领域代码按以下边界组织：

- `domain/auth`：身份、角色和权限上下文。
- `domain/geography`：城市、区域、商圈、线路和站点。
- `domain/supply`：商户、楼盘、房源和有效供给。
- `domain/review`：房源审核和快照。
- `domain/report`：房源举报。
- `domain/crm`：客户、线索、归属和跟进。
- `domain/workflow`：事件、待办、通知和 SLA。
- `domain/analytics`：指标注册、查询上下文和下钻。
- `domain/audit`：追加式审计。

Collection hooks 只负责输入边界、访问控制和调用领域服务。不要把跨对象事务、长状态机或统计逻辑堆进 Collection 文件。

## 5. 不可违反的业务不变量

### 5.1 房源状态必须独立

房源至少包含三个互不替代的机器字段：

- `publication_status`：草稿、已上架、已下架、已出租。
- `review_status`：未提交、待审核、审核通过、已驳回。
- `supply_visibility_hold`：正常、待复核。

禁止：

- 将“已驳回”塞入发布状态。
- 审核通过后默认自动上架。
- 因楼盘、区域或商户停用而改写审核状态或发布状态。
- 将三个状态拼成一个持久化组合状态。

只有具备发布权限的显式操作才能上架。审核人同时具备审核和发布权限、明确选择“通过后上架”并满足有效供给谓词时，才允许在同一事务完成审核和发布。

### 5.2 有效供给谓词必须唯一

前台、后台预览、楼盘聚合、线索推荐候选和数据看板必须调用同一服务端有效供给查询。

不得在页面或组件中各自放宽条件。最低条件见 `design.md`，包括：

- Listing 未逻辑删除。
- 已上架且审核通过。
- 未处于待复核冻结。
- 未被有效举报暂停。
- 媒体完整。
- Building、城市和区域启用。
- 当前 Listing 商户关系有效。
- 商户启用、资质有效且服务城市覆盖楼盘城市。

### 5.3 线索阶段与归属分离

- 线索阶段：新建、待分配、跟进中、有效商机、带看、谈判、已转化、已流失。
- 归属状态：未分配、已分配、公海。
- 公海不是线索阶段。
- 合并状态不是线索生命周期。

所有分配、认领、转派和回收必须追加归属历史，不得覆盖后丢失原负责人。

### 5.4 MVP-R1 参数必须快照

线索分配、认领、SLA 和回收必须保存：

- `runtime_policy_version=MVP-R1`
- 分配时限 7200 秒
- 首次有效跟进时限 14400 秒
- 认领保护期 86400 秒
- 无有效跟进回收时限 259200 秒
- 去重窗口 2592000 秒
- 每日成功认领上限 20
- 活跃自有线索上限 100
- 跟进纠错窗口 86400 秒

不得只读取当前默认值，也不得在本期通过字典或普通后台配置修改这些参数。

### 5.5 不可变历史

以下数据不得物理删除或原地改写历史：

- 审核记录和审核快照。
- 跟进记录；纠错通过追加修正记录完成。
- 归属历史。
- 关键状态变更记录。
- 操作审计日志。
- 已被业务引用的主数据。

有关联的数据优先停用或逻辑删除。

### 5.6 时间、价格与标识

- 数据库存储 UTC，产品显示和自然日统计使用 `Asia/Shanghai`。
- 金额必须保存数值、币种、计价周期和单位，禁止只保存拼接文本。
- 面积基础单位为平方米，支持一位小数。
- 业务关系使用不可变内部 ID，不使用名称、手机号或地址作为主键。
- 手机号先规范化再查重；客户历史查询与 30 天重复线索窗口不得混为一谈。

## 6. 权限与安全

权限由四层共同决定：

1. 菜单权限。
2. 操作权限。
3. 数据权限。
4. 字段权限。

强制规则：

- 权限必须在服务端 Payload access、领域服务或 endpoint 中执行。
- 隐藏按钮不是权限控制。
- 客户端提交的角色、城市、团队或负责人范围不可信。
- URL 查询参数不得扩大用户数据范围。
- 手机号、IP、设备、坐标和审计前后值按字段权限脱敏。
- 导出继承当前筛选、数据权限和字段权限，并记录审计。
- Custom Views 默认可能公开，必须使用统一服务端登录和权限守卫。
- 直接调用无权限 API 应返回 403，不能只在 UI 提示。
- 旧版本写入返回 409，禁止静默覆盖他人修改。

内置角色固定为：

- `ADM` 平台管理员
- `OPS` 运营人员
- `MGR` 销售主管
- `BRK` 经纪人
- `CSR` 客服

不得创建第六种内置角色，也不得删除或改码这五种角色。

## 7. Payload 实现约束

- 优先使用 Payload 原生 Collection、Field、Access、Hook、Local API 和 Custom View。
- 后台自定义组件从 `@payloadcms/ui` 导入 Payload UI 能力，版本必须与 `payload` 一致。
- Custom Component 路径通过 `payload.config.ts` 注册；不要手工编辑生成的 `importMap.js`。
- 修改后台组件注册后运行 `pnpm exec payload generate:importmap`。
- 修改 Collection 或 Global 后运行 `pnpm exec payload generate:types`。
- C 端 Server Components 使用 Local API，不要绕行请求自身 REST API。
- 业务动作优先使用明确 endpoint 或领域服务，不要让客户端组合多次写入模拟事务。
- 核心业务逻辑不得依赖社区 UI 插件。
- 社区插件引入前检查 Payload 3.86 兼容性、维护状态、Peer Dependencies、样式作用域和卸载方案。

## 8. UI 与样式约束

- 后台沿用 Payload 原生表单、主题和交互语义。
- Arco Design 只用于 Dashboard、图表、指标和 Payload 原生组件不足的复杂区域。
- Arco 样式必须限定在明确命名的后台组件容器内。
- 禁止重新引入 shadcn/ui、Tailwind reset 或全局第三方 CSS reset。
- 禁止覆盖 Payload 全局主题 token 来“换肤”。
- Light/Dark 必须通过 Payload 原生 `useTheme` 管理。
- 页面级 Custom View 必须支持中文、暗色模式、空状态、错误状态和无权限状态。
- 图标使用同一专业图标库，不使用 emoji 充当操作图标。
- 长表单优先使用 Tabs、Row、Collapsible 和侧栏分组，不改变字段数据路径。

## 9. 数据库与迁移

### 9.1 通用规则

- 任何 Collection、字段、索引、约束或关系变更都必须生成并提交显式迁移。
- 迁移采用“扩展 → 回填 → 双读验证 → 切换 → 收敛”。
- 未经用户明确确认，不得删除旧字段、表、索引或历史数据。
- 每次迁移必须提供 dry-run、影响数量、校验结果和回滚说明。
- 旧数据无法可靠推断时生成待人工处理清单，不要自动放宽业务条件。

### 9.2 PostgreSQL

- 生产 PostgreSQL 是共享数据库，`push: false`。
- 禁止在生产或类生产环境使用 Payload dev schema push。
- 只使用显式迁移。
- 供给有效期关系必须使用数据库级约束防止重叠。

### 9.3 SQLite

- SQLite 只用于本地开发和快速测试。
- PostgreSQL exclusion constraint 等能力在 SQLite 中用事务内应用校验模拟。
- 不得因 SQLite 通过就宣称 PostgreSQL 约束已验证。
- 开发服务器配置热更新可能并发初始化 schema；修改 Payload 配置后优先冷重启，避免同时触发多个后台请求。

## 10. 事件、待办与审计

- 跨对象副作用使用事务 Outbox。
- 领域事件必须有稳定 `event_id`、聚合 ID 和聚合版本。
- 消费器必须幂等，重复投递不能生成重复待办、通知或审计。
- 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成。
- 高风险操作的业务写入、事件和审计必须位于同一事务或可靠编排中。
- 高风险操作审计失败时，业务操作必须失败。
- 审计日志只允许追加和读取，不提供 update/delete。

## 11. TypeScript 与代码质量

- 禁止使用 `any`、`as any`、`@ts-ignore` 或 `@ts-nocheck` 绕过类型系统。
- 外部未知数据使用 `unknown` 并通过类型守卫或 schema 校验收窄。
- 第三方类型错误使用本地 module augmentation 或精确适配器，不要污染业务类型。
- 不捕获并吞掉错误。
- 不通过删除测试、跳过断言或关闭 lint 让检查变绿。
- 可复用业务规则写成纯函数并提供单元测试。
- 状态机和权限规则必须有非法路径测试，不只测成功路径。
- 不在组件中重复服务端查询口径。

## 12. 必须执行的验证

按改动范围执行，非平凡改动至少包括：

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm build
```

规则：

- 未修改 Collection 时可省略 `generate:types`。
- 未修改后台组件注册时可省略 `generate:importmap`。
- 用户可见的页面、表单、路由、权限和状态变化必须在真实浏览器验证。
- 浏览器验证至少包含目标页面、一个相邻页面和控制台错误检查。
- 权限改动必须使用相关角色分别验证 UI 与直接 API。
- 数据迁移必须在数据副本验证数量、状态和关系完整性。
- 生产 PostgreSQL 专属约束必须在 PostgreSQL 环境验证。
- 若任何验证未执行，最终交付必须明确说明缺口，禁止笼统声称“全部正常”。

## 13. Git 与工作树安全

- 当前工作树可能包含用户未提交修改；不得覆盖或回滚不属于当前任务的变更。
- 禁止使用 `git reset --hard`、`git checkout --` 或其他破坏性恢复命令。
- 提交只暂存明确文件；禁止 `git add .`、`git add -A` 和 `git commit -am`。
- 不提交数据库文件、环境变量、密钥、上传文件或临时截图。
- 不修改自动生成文件，除非生成命令明确要求并已核对差异。
- 新分支遵循仓库现有约定；未经用户要求不要自动提交、推送或创建 PR。

## 14. Agent 工作流程

每个开发任务按以下顺序执行：

1. 确定对应 PRD、Requirement 和 `tasks.md` 编号。
2. 阅读受影响 Collection、领域服务、迁移、页面和测试。
3. 明确影响范围、数据风险、权限变化和验收条件。
4. 对非平凡数据模型、权限、路由或 API 变更取得用户确认。
5. 先写或更新测试，再实现最小完整闭环。
6. 生成类型、迁移和 import map。
7. 执行静态、单元、构建、数据库和浏览器验证。
8. 更新 `tasks.md` 状态和必要设计文档。
9. 交付时报告实际结果、证据、剩余风险和未验证项。

禁止：

- 未获批准跨里程碑开发。
- 用 UI 假数据伪装后端功能完成。
- 只完成表单字段，不完成权限、状态、审计和异常路径。
- 将 PRD 中的固定状态机改为可配置字典。
- 为追求短期速度破坏历史数据或跳过迁移。

## 15. 完成定义

一个任务只有同时满足以下条件才可标记完成：

- 用户可见结果符合对应 PRD。
- 服务端权限和数据范围正确。
- 状态机只允许合法转换。
- 关键动作产生正确审计和事件。
- 迁移可重复执行且具有校验报告。
- TypeScript、测试和构建通过。
- 浏览器目标流程和相邻流程通过。
- 无新增控制台错误。
- `tasks.md` 已更新。
- 交付说明列出所有剩余风险和验证缺口。
