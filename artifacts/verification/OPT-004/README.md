# OPT-004 SQLite schema 启动幂等性验证

日期：2026-07-26

## 实现

- `src/lib/serialized-sqlite-adapter.ts` 包装官方 SQLite adapter。
- Payload 在 `connect()` 内执行开发 schema push；包装器使用 `globalThis` 共享 Promise 队列串行执行 connect。
- `src/payload.config.ts` 仅在 SQLite 路径使用包装器，并设置 `busyTimeout: 10000`。
- PostgreSQL adapter 保持 `push: false`，未改变生产迁移策略。

## 自动化

- `pnpm typecheck`：通过。
- `pnpm test`：通过，92 个测试文件、1862 个测试。
- `pnpm build`：通过。
- 新增 `tests/serialized-sqlite-adapter.test.ts`：
  - 保持官方 adapter 的名称与初始化契约；
  - 两个并发 connect 工作单元严格按先后顺序执行。

## 现有数据库验证

1. 使用默认 `payload.db.sqlite` 冷启动 `pnpm dev`。
2. 同时发送 4 个首页请求。
3. 结果：`200 / 200 / 200 / 200`。
4. 服务日志只执行一次 schema pull，无重复索引错误。

## 全新数据库验证

数据库地址：

`file:E:/github/sbh/artifacts/verification/OPT-004/fresh.sqlite`

首次冷启动并同时发送 4 个首页请求：

`200 / 200 / 200 / 200`

停止服务后，使用同一数据库再次冷启动并请求首页：

`200`

未出现 `payload_locked_documents_rels_order_idx already exists`。

## 清理与限制

- 验证完成后，临时数据库已移出工作区至
  `C:/Users/Administrator/AppData/Local/Temp/sbh-opt-004-fresh.sqlite`，
  不属于项目交付物且不会进入版本控制；需要复查原始验证库时可从该位置读取。
- 当前执行环境为 Node 24.14.0，项目声明 Node 22.x，命令仍有 engine 警告。
- 互斥范围是单个 Node 进程；不要同时运行两个指向同一 SQLite 文件的独立开发服务。生产 PostgreSQL 不使用本机制。
