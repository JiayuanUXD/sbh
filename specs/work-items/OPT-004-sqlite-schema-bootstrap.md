# Task Packet：OPT-004 SQLite schema 启动幂等性

> 状态：已完成
> 创建日期：2026-07-26
> 最后更新：2026-07-26

## 1. 目标

本地执行 `pnpm dev` 时，系统应先以单进程完成 SQLite schema 同步，再启动 Next 开发服务，避免多个 Payload 初始化上下文并发创建同一索引。

## 2. 非目标

- 不改变 PostgreSQL `push: false` 与显式迁移策略。
- 不修改业务 Collection、字段或历史数据。
- 不把 SQLite 验证等同于 PostgreSQL 生产迁移验证。

## 3. 权威上下文

- 审查项：`docs/reviews/2026-07-26/optimization-backlog.md#第一批发布阻断`
- Agent：`payload-office-platform/AGENTS.md`、`.agent/core.md`、`.agent/migrations.md`、`.agent/testing.md`

## 4. 当前行为与证据

- 复现：启动开发服务后首次访问 `/`。
- 当前结果：曾出现 `payload_locked_documents_rels_order_idx already exists`，首次请求 HTTP 500；再次冷启动后恢复。
- 期望结果：schema push 仅在预启动进程执行一次；Next 运行期所有 Payload 初始化均关闭 push。
- 修改前证据：`artifacts/verification/AUDIT-001/README.md`。

## 5. 影响范围

- 预计修改：`package.json`、`src/payload.config.ts`、新增 SQLite bootstrap 脚本。
- 数据模型/迁移：不新增模型或迁移；只改变本地 schema 同步编排。
- 权限/API/缓存：无变化。
- 风险：关闭运行期 push 后，若绕过 `pnpm dev` 直接运行 Next，SQLite schema 不会自动更新。

## 6. 实施清单

- [x] 建立可复现用例并定位并发 push 根因。
- [x] 在 SQLite adapter connect 外围实现进程级串行化。
- [x] 为 SQLite 增加 10 秒锁等待，降低短暂写锁冲突。
- [x] 验证现有数据库冷启动与四路并发首页请求。
- [x] 验证全新临时数据库冷启动、四路并发请求与再次冷启动。
- [x] 更新证据与任务状态。

## 7. 验收

- 当使用现有 SQLite 数据库连续冷启动两次时，系统应均能返回首页 HTTP 200，且不得出现重复索引错误。
- 当使用全新 SQLite 数据库启动时，系统应自动创建 schema 并返回首页 HTTP 200。
- 当配置 PostgreSQL 时，系统应继续保持 `push: false`，预启动步骤不得连接或变更 PostgreSQL。
- 类型检查、相关自动化测试和构建应通过。

## 8. 结果

- 修改文件：`src/lib/serialized-sqlite-adapter.ts`、`src/payload.config.ts`、`tests/serialized-sqlite-adapter.test.ts`。
- 实际结果：SQLite connect/schema push 已串行化；现有库和全新库均通过并发及重复冷启动验证。
- 验证摘要：类型检查通过；92 个测试文件、1862 个测试通过；生产构建通过；两类 SQLite 数据库均返回 HTTP 200。
- 详细证据：`../../artifacts/verification/OPT-004/README.md`
- 剩余风险：进程级互斥不覆盖两个独立 Node 进程同时操作同一 SQLite 文件；本地开发约束仍是同一数据库只运行一个 dev 服务。
- 下一步：OPT-001，修复审核记录与审核队列数据权限。
