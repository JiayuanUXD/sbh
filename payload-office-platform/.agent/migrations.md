# 数据库与迁移规则

## 通用

- Collection、字段、索引、约束和关系变化必须生成显式迁移。
- 流程：扩展 → 回填 → 双读验证 → 切换 → 收敛。
- 未经确认不得删除旧字段、表、索引、约束或历史数据；「确认」的唯一载体是顶层 `DESTRUCTIVE_MIGRATION_APPROVALS.json`，见下方「破坏性迁移的批准机制」。
- 旧数据无法可靠推断时输出人工处理清单，不放宽业务条件。
- 每次迁移提供 dry-run、影响数量、校验和回滚说明。

## 破坏性迁移的批准机制（撞上 DROP TABLE / DROP COLUMN 红灯时先读这一节）

迁移 `up()` 里出现 `DROP TABLE` / `DROP COLUMN`，会被**四道独立的闸门**同时拦下：

| # | 闸门 | 触发时机 |
|---|---|---|
| 1 | `scripts/preflight.ts`（`pnpm preflight:migrate`） | CI `quality.yml` |
| 2 | `scripts/migrate-dry-run.ts`（`pnpm migrate:dry-run`） | CI 两个 job |
| 3 | `tests/preflight-migrations.test.ts` 的 blanket 断言 | `pnpm test` → 本地 `.githooks/pre-push` + CI |
| 4 | `scripts/migrate-verify.ts`（`pnpm migrate:verify`） | CI `postgres-migrations` job |

四道闸共读同一份数据源，走同一个共享模块 `scripts/destructive-migration-approvals.ts`。**批准的唯一载体是顶层 `DESTRUCTIVE_MIGRATION_APPROVALS.json`**：四处闸门代码本身都不写死任何迁移名，谁被批准、批准了什么，只在这一份文件里，它的 diff 就是批准留痕。

**红灯了怎么办：**

1. **这次删除还没获得用户批准** → 不要自己放行。按「扩展 → 回填 → 双读 → 切换 → 收敛」处理，或先向用户说明影响面（涉及多少行、是否可逆、读侧是否已迁完）并取得明确批准。
2. **已获用户明确批准** → 在 `DESTRUCTIVE_MIGRATION_APPROVALS.json` 的 `approvals` 数组里新增一条，字段齐全：`migrationName` / `approvedIn`（工作项编号）/ `approvedWhat` / `impact` / `approvedFileSha256`。一条 = 一次独立的人工批准，不要复用或扩展已有条目。
3. **清单里已经有这条迁移，却还是红** → 这是最常见的情况，也最容易被误读：**批准绑定的是整份迁移 `.ts` 文件内容的 SHA-256**，在头注释里加一个空格就足以让四道闸同时变红。此时闸门打印的「必须经过扩展 → 回填 → 双读」与真实原因（指纹过期）毫无关系。跑 `pnpm migrate:approval-hash` 逐条比对并打印新摘要，**复核这次改动仍在用户批准的范围内**之后，把新摘要写回该条目的 `approvedFileSha256`。

**禁止的反应**（这几条正是批准机制要防的）：`SKIP_PREPUSH=1` / `--no-verify` 整体绕过；删掉迁移重新生成（新文件指纹一样对不上，还会丢掉迁移头注释里的批准背景）；在闸门代码里按迁移名加白名单；把批准散落到 CI 配置或环境变量里。

`TRUNCATE` 一类没有 `kind` 标签的风险**不在批准清单的覆盖范围内**，没有放行通道。

`pnpm migrate:approval-hash [迁移名]`：不带参数逐条体检清单里的全部批准（指纹一致 / 已过期 / 文件已不存在）；带迁移名只打印该文件当前内容的 SHA-256。

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

