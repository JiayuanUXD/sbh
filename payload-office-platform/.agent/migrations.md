# 数据库与迁移规则

## 通用

- Collection、字段、索引、约束和关系变化必须生成显式迁移。
- 流程：扩展 → 回填 → 双读验证 → 切换 → 收敛。
- 未经确认不得删除旧字段、表、索引、约束或历史数据。
- 旧数据无法可靠推断时输出人工处理清单，不放宽业务条件。
- 每次迁移提供 dry-run、影响数量、校验和回滚说明。

## PostgreSQL（本地 / CI / 生产统一）

- 全环境 PostgreSQL，`push: false`，SQLite 回退已移除；`DATABASE_URL` 缺省或非 `postgres://` 在 onInit fail-fast。
- 任何环境禁止 Payload dev schema push（生产是共享 TencentDB，push 会扫到腾讯云拨测表并在非 TTY 卡死）。
- 关系有效期的排斥约束、唯一和枚举在 PostgreSQL 环境验证；ENUM 字段的 `defaultValue` 必须在 `options` 内，否则 PG 直接拒绝插入。
- 高风险业务写入、事件和审计使用同一事务或可靠编排。
- 多 worktree 并行各用独立库名（`sbh_dev_<task>`），禁止共用或指向生产。
- 修改 Payload 配置后优先冷重启，避免热更新并发初始化 schema。

## 数据安全

- 不提交数据库、密钥、环境文件、上传媒体和个人信息。
- 不用数据清理代替迁移修复。
- 迁移验证记录写入 `../artifacts/verification/<工作项编号>/`。

