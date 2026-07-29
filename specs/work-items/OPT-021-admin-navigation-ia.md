# Task Packet：OPT-021-admin-navigation-ia 后台导航信息架构优化

> 状态：已完成（自动化 + E2E 34 passed + 截图证据齐备）
> 创建日期：2026-07-28
> 最后更新：2026-07-29

## 1. 目标

把后台导航重组为九个中文业务分组，按角色和服务端权限过滤，并提供安全的行动数量提醒与详情上下文入口。

## 2. 非目标

- 不改变 Collection slug、REST API 和数据关系。
- 不重构业务详情表单和业务状态机。
- 不用菜单隐藏替代服务端权限。

## 3. 权威上下文

- Design/Requirement：`docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#12-验收标准`。
- Agent：`payload-office-platform/AGENTS.md` + `.agent/core.md`；实施权限改动时读取 `.agent/permissions.md`。

## 4. 当前行为与证据

- 复现路径：登录 Payload 后台，查看自动生成的左侧导航。
- 当前结果：默认导航出现“集合 / workflow / system”；`lead-ownership-history`、`search`、`domain-events`、`audit-logs` 为平级入口。
- 证据：`payload-office-platform/src/payload.config.ts` 注册 `search` 与 `lead-ownership-history`；`Tasks.ts`、`Notifications.ts`、`DomainEvents.ts` 使用 `workflow` 分组，`AuditLogs.ts` 使用 `system` 分组。
- 期望结果：导航按设计稿第 4 节的九个中文业务分组呈现，低频记录和高级工具按设计稿迁移。
- 修改前截图/日志：本任务仅建立验收基线，后续实现任务补充浏览器截图和验证日志。

## 5. 影响范围

- 预计修改文件：后续任务将修改自定义 Admin Nav、Collection 展示/分组配置、角色权限映射、数量聚合接口和相关测试；本任务只新增本 Task Packet。
- 数据模型/迁移：不修改；Collection slug、REST API 和数据关系保持不变。
- 权限：菜单展示按角色、菜单权限、操作权限与 Collection `read` 权限共同决定；后端仍是直接 URL 和数据访问的最终边界。
- API/路由：后续可新增数量聚合接口；既有稳定 URL 不变。
- 缓存/事件：后续数量聚合按用户和短时间窗口缓存；提醒失败不阻止菜单渲染。
- 风险：仅隐藏菜单会造成越权；数量接口可能泄露无权限数据；九个分组在小屏幕上可能导致滚动或遮挡问题。

## 6. 实施清单

- [x] 从模板建立 OPT-021 Task Packet，并记录固定目标、非目标、现状和影响范围。
- [x] 建立覆盖信息架构、权限、桌面/移动交互、直接 URL、数量边界与回归的可追踪验收基线。
- [ ] 建立菜单配置和旧名称到新名称的映射。
- [ ] 完成桌面端导航分组和权限过滤。
- [ ] 完成移动端折叠菜单、低频入口迁移、详情上下文入口和数量提醒。
- [ ] 完成角色矩阵、直接 URL 权限、数量边界、桌面/移动浏览器及现有功能回归验证。

## 7. 验收

- [ ] [设计稿 12.1：信息架构](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#121-信息架构)：一级分组名称、顺序和子项与第 4 节一致。
- [ ] [设计稿 12.1：信息架构](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#121-信息架构)：不再出现“集合”“workflow”“system”等技术分组名。
- [ ] [设计稿 12.1：信息架构](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#121-信息架构)：线索归属历史不再占用主导航。
- [ ] [设计稿 12.1：信息架构](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#121-信息架构)：搜索索引、领域事件、审计日志仅在高级工具中出现。
- [ ] [设计稿 12.1：信息架构](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#121-信息架构)：素材库、提交数据、审核队列、举报处理使用目标名称。
- [ ] [设计稿 12.2：权限](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#122-权限)：ADM 可见全部九个分组。
- [ ] [设计稿 12.2：权限](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#122-权限)：OPS、MGR、BRK、CSR 分别仅看见权限内分组；验证五类角色的默认可见性与实际权限交集。
- [ ] [设计稿 12.2：权限](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#122-权限)：分组无可访问子项时整体隐藏。
- [ ] [设计稿 12.2：权限](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#122-权限)：直接访问无权 URL 仍被后端拒绝。
- [ ] [设计稿 12.2：权限](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#122-权限)：数量提醒不包含无权限数据。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：桌面端一次只展开一个业务分组。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：当前路由所属分组始终展开并高亮。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：移动端点击菜单后抽屉关闭。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：系统管理默认折叠并置底。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：刷新页面后导航定位正确。
- [ ] [设计稿 12.3：交互](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#123-交互)：数量为 0 时隐藏、1 和 99 时显示实际数字、100 时显示 `99+`。
- [ ] [设计稿 12.4：回归](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#124-回归)：所有现有 Collection 仍可通过目标入口访问。
- [ ] [设计稿 12.4：回归](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#124-回归)：Collection slug、REST API 和数据关系不变。
- [ ] [设计稿 12.4：回归](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#124-回归)：后台登录、退出和账号入口不受影响。
- [ ] [设计稿 12.4：回归](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#124-回归)：现有工作台、房源、审核、线索和权限测试通过。
- [ ] [设计稿 12.4：回归](../../docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md#124-回归)：桌面端和移动端均不存在无法滚动或菜单被遮挡问题。

## 8. 结果

- 实现范围：Task 1–10 代码已落地（导航配置/角色权限/服务端可见性/表单提交状态/数量 endpoint/默认导航退出/响应式导航/详情上下文入口/E2E 用例）。
- 安全缺口修复：E2E 发现 BRK 可读「负责人为空/他人」线索；`src/domain/crm/lead-read-access.ts` 补 `self` 范围服务端 read（`owner.user === userId` + 账号城市上限），单测 `tests/lead-read-access.test.ts` 3 passed，E2E `permission-matrix.spec.ts` 加回归。
- 本轮改动：修复 `AdminNavigation.tsx` 的 `react-hooks/error-boundaries` lint error（JSX 构造移出 try/catch）。
- 自动化验证（全部退出码 0）：
  - `generate:types` / `generate:importmap` 无 diff；`tsc --noEmit` 无错误；`pnpm lint` 0 error（仅 8 条前端既有 `<img>` warning）。
  - `pnpm test`：120 文件 / 2125 测试全通过。
  - `pnpm build`：编译成功、全路由（含 `/admin`）在产物中（需 `NEXT_PUBLIC_SITE_URL`）。
  - `migrate:dry-run`：两个 OPT-021 迁移 up/down/no forbidden patterns；`migrate:verify`：100 checks / 0 fail。
- 详细证据：`../../artifacts/verification/OPT-021-admin-navigation-ia/README.md`。
- 浏览器 / E2E（隔离 SQLite + seed，worktree server 3718）：`admin-navigation.spec.ts` + `permission-matrix.spec.ts` **34 passed / 0 failed**；四张截图（adm-desktop / ops-desktop / brk-mobile / dark-mode）已生成，角色矩阵/响应式/暗色均符合设计。
- 修复：`permission-matrix.spec.ts` 的 `BASE` 由硬编码 3717 改为跟随 `PORT`，消除非默认端口下 API 打错服务的假失败；新增 `scripts/opt021-shots.ts` 截图脚本。
- 剩余项：无（Task 11 证据齐备，待并入主线）。
