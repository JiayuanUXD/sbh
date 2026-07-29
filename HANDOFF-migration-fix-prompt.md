# 交接 Prompt：修复 Postgres 迁移漂移（给另一个 IDE / Agent）

> 直接把下面整段贴给另一个 IDE 的 agent。它是自包含的，不依赖任何历史对话。

---

# 任务：修复 Postgres 迁移漂移，让 PG seed 恢复可用

## 背景
仓库 `JiayuanUXD/sbh`（单体仓，应用在 `payload-office-platform/`，Next.js 16 + Payload 3.86）。
另一条在建的 stacked PR（#7，让全量 E2E 在 CI 跑绿）新增了一个 `e2e` CI 作业，它在
Postgres 上 `pnpm seed` 时失败，暴露出一个**既有的迁移漂移 bug**。仓库里既有的
`postgres-migrations` 作业也会栽在同一步。**本任务只修这个迁移漂移**，不碰 E2E 那条 PR。

## 现象 / 根因（已定位，无需重新排查）
- CI e2e 作业 `pnpm seed` 报错：
  `column ...audit_logs_id does not exist`（Postgres code 42703），
  发生在 `scripts/seed.ts` 的 `payload.update({collection:'listings'})` → Payload 文档锁检查
  查询 `payload_locked_documents_rels` 时。
- 根因：Payload 配置里有 `AuditLogs`（slug `audit_logs`）collection，核心表
  `payload_locked_documents_rels` 应为每个 collection 建一列 `<slug>_id`，因此需要
  `audit_logs_id`。但 `src/migrations/` 里**没有任何迁移定义该列**
  （`grep -rn audit_logs_id payload-office-platform/src/migrations` 应为空）。
- 本地开发 / CI 的 `quality` 作业用 **SQLite**，适配器按 config 自动同步 schema → 列存在 → 不报错。
- 生产 / CI 用 **PostgreSQL**（`src/payload.config.ts` 里 `push:false`，只走显式迁移）→ 列缺失 → 报错。
- 可能不止 `audit_logs` 一列缺，`migrate:create` 会一并补齐 config 与迁移之间的所有漂移。

## 在哪条分支做
**在 `codex/opt-021-admin-navigation` 上修**（bug 归属这里；修好后它自己的
`postgres-migrations` 作业也能恢复绿，下游 stacked PR #7 自然继承）。
```bash
git fetch origin && git switch -c fix/pg-locked-docs-audit-logs-rel origin/codex/opt-021-admin-navigation
```

## 硬约束（项目纪律，务必遵守）
- **迁移文件正文绝不可手改**；改 schema 必须用 `pnpm exec payload migrate:create` 生成，提交 `src/migrations/`。
- 包管理器是 **pnpm@8.6.1**（用 pnpm，不用 npm/yarn）。
- 提交只用**显式 `git add <具体路径>`**，禁用 `git add -A` / `git add .` / `git commit -am`。
- 所有文档/提交信息中文用**简体中文**。
- `DATABASE_URL` 以 `postgres` 开头 → 用 PG；否则用本地 SQLite。生产共享库是 `push:false`。
- 仓库常多 worktree 并行：用**独立端口 + 独立 DB**，别碰归属不明的本机 5432 实例；起临时 PG 用 docker。

## 步骤
1. 起一个一次性的 Postgres（别用未知的本机实例）：
   ```bash
   docker run --rm -d --name sbh-pg-fix -e POSTGRES_USER=payload -e POSTGRES_PASSWORD=payload \
     -e POSTGRES_DB=payload_m0 -p 5433:5432 postgres:16.6
   export DBURL='postgres://payload:payload@127.0.0.1:5433/payload_m0'
   ```
2. 生成缺失的迁移：
   ```bash
   cd payload-office-platform
   pnpm install --frozen-lockfile
   pnpm generate:types && pnpm payload generate:importmap
   # 先把已有迁移灌到空库，再让 migrate:create 只 diff 出漏掉的（audit_logs_id 等）
   DATABASE_URL="$DBURL" PAYLOAD_SECRET=ci-only-local pnpm exec payload migrate
   DATABASE_URL="$DBURL" PAYLOAD_SECRET=ci-only-local pnpm exec payload migrate:create locked_docs_audit_logs_rel
   ```
   预期新迁移含 `ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_logs_id" ...`（可能还有别的 collection 缺列，一并补齐）。**不要手改生成的正文。**
3. 在**全新空库**上验证「迁移 + seed」端到端跑通（这就是 CI 里失败的路径）：
   ```bash
   docker exec sbh-pg-fix psql -U payload -c 'DROP DATABASE IF EXISTS v; CREATE DATABASE v;'
   V='postgres://payload:payload@127.0.0.1:5433/v'
   DATABASE_URL="$V" PAYLOAD_SECRET=ci-only-local pnpm exec payload migrate
   DATABASE_URL="$V" PAYLOAD_SECRET=ci-only-local pnpm seed        # ← 之前就是这步 42703 失败
   DATABASE_URL="$V" PAYLOAD_SECRET=ci-only-local pnpm migrate:verify
   ```
   `pnpm seed` 不再报 `audit_logs_id does not exist` 即为修好。
4. 提交（显式路径）：
   ```bash
   git add payload-office-platform/src/migrations/<新生成的文件>
   git commit -m "fix(db): 补 payload_locked_documents_rels 缺失的 audit_logs_id 列迁移"
   git push -u origin fix/pg-locked-docs-audit-logs-rel
   docker rm -f sbh-pg-fix
   ```
5. 开 PR（base `codex/opt-021-admin-navigation`），确认 CI 的 `postgres-migrations` 作业恢复绿。

## 完成判据
- 全新 PG 上 `pnpm exec payload migrate && pnpm seed` 跑通，无 42703。
- `postgres-migrations` CI 作业绿。
- 迁移文件是 `migrate:create` 生成、正文未手改。

## 参考
- 详细交接见 stacked 分支 `claude/amazing-thompson-40db1a` 根目录的 `HANDOFF-e2e-ci-green.md`。
- 失败的 CI run：`gh run view 30436849573`，e2e job 90526491252（seed 步日志有完整报错栈）。
