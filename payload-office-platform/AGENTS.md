# Payload 平台 Agent 入口

本文件适用于 `payload-office-platform/` 全部目录。它只负责上下文路由；具体规则按任务读取 `.agent/` 中的专项文件，禁止每次加载全部规则和全部 PRD。

## 1. 每个任务都要读取

1. 本文件。
2. [`.agent/core.md`](./.agent/core.md)。
3. 当前任务包；若尚未建立，先在本会话概述任务目标与范围。
4. 与任务直接相关的代码与测试。

## 2. 按任务增量读取

| 任务类型 | 额外读取 |
|---|---|
| Payload 后台页面、Collection、Hook、Custom View | [`.agent/backend.md`](./.agent/backend.md) |
| C 端页面、组件、公开查询、SEO、咨询 | [`FRONTEND_AGENT.md`](./FRONTEND_AGENT.md) |
| 有效供给、楼盘、房源、商户关系 | [`.agent/supply.md`](./.agent/supply.md) |
| 登录、角色、菜单、操作、数据或字段权限 | [`.agent/permissions.md`](./.agent/permissions.md) |
| Collection、字段、索引、约束或生产数据变化 | [`.agent/migrations.md`](./.agent/migrations.md) |
| 测试、浏览器验收、构建或完成声明 | [`.agent/testing.md`](./.agent/testing.md) |

只在任务实际跨域时组合读取。例如前台房源卡片读取 `frontend + supply + testing`，后台角色页读取 `backend + permissions + testing`。

## 3. 权威来源

历史 PRD / 实施计划 / 规格已移除，**以代码为唯一事实源**：collection 配置、`src/domain`、`src/lib/frontend`、`src/migrations`、测试。跨面业务规则见 `.agent/` 专项文件。需要时用 `rg` 在 `src/` 定位章节，不要整份读取大文件。

## 4. 不可协商的总规则

- 包管理器固定为 pnpm；不得用 npm/yarn 改写锁文件。
- 禁止用 `any`、`as any`、`@ts-ignore`、`@ts-nocheck` 绕过类型。
- 外部输入使用 `unknown` 并以 schema/类型守卫收口。
- 权限必须在服务端执行；隐藏按钮不是权限控制。
- 不得物理删除已引用主数据、业务历史、审核、举报、跟进、归属或审计。
- 前台、预览、楼盘聚合、推荐、咨询候选和看板必须复用统一有效供给服务。
- 禁止重新引入 shadcn-ui、Tailwind reset、全局第三方 CSS reset、S3 或 SEO 插件。
- 未经用户确认不得跨越当前获批里程碑、执行破坏性迁移、提交、推送或创建 PR。
- 保留工作树中用户和其他任务的修改；禁止 `git reset --hard`、`git checkout --`。
- 用户可见页面、路由、表单、权限和状态变化必须真实浏览器验证。
- 只有代码、测试、构建、浏览器和必要数据校验均有证据时，才可标记任务完成。

## 5. 标准工作流

1. 选择唯一任务编号并建立/读取 Task Packet。
2. 读取与任务相关的 `.agent/` 规则、代码和测试。
3. 记录修改前行为、影响范围、数据/权限风险及明确非目标。
4. 为复杂数据、权限、API、路由或视觉变化取得确认。
5. 先建立可复现失败或测试，再完成最小闭环。
6. 执行 Task Packet 中的静态、测试、构建、数据库和浏览器验证。
7. 将详细证据写入任务包或 PR 描述，字段只保留短摘要和链接。
8. 只更新实际完成的复选框，交付剩余风险和未验证项。

## 6. 上下文预算

- 单次任务只激活一个主任务编号。
- 优先修改 3–8 个核心文件；超出时拆分任务包。
- 搜索先于整文件读取；日志只返回失败摘要，完整输出存证据目录。
- 当前会话只保留目标、决策、文件、验证和下一步；历史细节写入 Task Packet。
- 当同一任务需要超过三个专项规则时，先判断是否应拆成两个任务。
