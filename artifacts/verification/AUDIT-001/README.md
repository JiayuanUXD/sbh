# AUDIT-001 验证记录

日期：2026-07-26

## 命令结果

- `pnpm typecheck`：通过。
- `pnpm test`：通过，91 个测试文件、1860 个测试。
- `pnpm build`：通过。
- `pnpm migrate:status`：SQLite 开发模式无法识别迁移应用状态；代码中有 16 个迁移。
- `pnpm preflight:env`：失败，缺少 PostgreSQL `DATABASE_URL` 与 `PAYLOAD_SECRET`；S3/COS 和 analytics 配置告警。

## 浏览器结果

目标：`http://localhost:3717/`

首次结果：失败，HTTP 500。Next/Payload 初始化时报：

```text
Failed query:
CREATE INDEX `payload_locked_documents_rels_order_idx`
ON `payload_locked_documents_rels` (`order`);

SQLITE_ERROR: index payload_locked_documents_rels_order_idx already exists
```

停止并重新启动开发服务后，以下路径可访问：

- `/`
- `/listings`（展示 8 套）
- `/listings/huangpu-bund-coworking`
- `/buildings/huangpu-bund`

复验发现房源详情有两个同名“房源说明”二级标题，“可入驻”直接展示 ISO 时间。首次初始化错误仍需作为 schema 幂等性问题处理。

## 环境偏差

项目声明 Node `22.x`，执行环境为 Node `24.14.0`。所有通过结果均带有 engine 警告，应在 Node 22 的目标环境复跑。
