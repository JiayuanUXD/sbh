# 交接文档：让 `quality.yml` 的 `pnpm test:e2e` 在 CI 跑绿

> 目的：把「让全量 E2E 在 CI 跑绿并去掉 `continue-on-error`」这项任务的当前进度、
> 已完成改动、以及当前**唯一阻塞点**交接给下一个 IDE / 会话继续。

## 0. 一句话现状

代码改动 + 本地验证**全部完成并已提交/推送**（PR #7）。CI 上 `e2e` 作业**未过**，
但失败点是一个**与本任务改动无关的、既有的 Postgres 迁移漂移 bug**（seed 阶段
`payload_locked_documents_rels.audit_logs_id` 列在 PG 里不存在）。这个 bug 会让**任何
PG seed**失败——包括仓库里既有的 `postgres-migrations` 作业。需要先修这个迁移漂移，
E2E 作业才能继续走到 build / next start / 跑测试。

## 1. 分支 / PR / 基线

- 工作分支：`claude/amazing-thompson-40db1a`（已推 origin）。
- **PR #7**：https://github.com/JiayuanUXD/sbh/pull/7 （**draft**）。
- **base 是 `codex/opt-021-admin-navigation`（stacked PR）**，不是 master——因为
  OPT-021 尚未并入 master，`admin-navigation.spec.ts` 与临时的 `continue-on-error`
  都只在该分支上。**须在 OPT-021 合并后再合本 PR。**
- 分支构成：`26e516e`(OPT-021 顶) → `9a50fe4`(cherry-pick 的并行开发纪律文档) →
  `d32fdea`(本任务的 E2E 改动)。

## 2. 已完成的改动（提交 d32fdea，8 个文件）

| 文件 | 改动 |
|---|---|
| `.github/workflows/quality.yml` | 新增独立 **`e2e` 作业**（PostgreSQL service + migrate + seed + seed:media + `next build` + `next start` 跑 Playwright）；`quality` 作业删掉 `playwright install` 与 `test:e2e`（连同 `continue-on-error`）。 |
| `payload-office-platform/playwright.config.ts` | baseURL 与 `NEXT_PUBLIC_SITE_URL` **解耦**（只认 `PLAYWRIGHT_BASE_URL` / `localhost:PORT`）；`E2E_PROD_SERVER=1` 时 `webServer` 用 `next start`，否则 `next dev`（本地体验不变）。 |
| `payload-office-platform/package.json` | 加脚本 `seed:media`（`--env-file-if-exists` + `scripts/seed-media.ts`）。 |
| `payload-office-platform/scripts/seed-media.ts` | CI/离线（`CI` 或 `SEED_MEDIA_OFFLINE`）用 **sharp 本地合成占位图**替代 picsum.photos，去外网依赖；`uploadMedia` 签名从 `(payload,alt,url,filename)` 改为 `(payload,alt,seed,w,h,filename)`。 |
| `tests/e2e/inquiry-flow.spec.ts` | 修过期断言：触发按钮标签 `/询价\|预约看房\|留电/` + `.first()`；label `手机号`；**补勾 consent 复选框**（required，否则原生校验拦截提交）。 |
| `tests/e2e/disabled-supply-not-reachable.spec.ts` | sitemap 的绝对 `<loc>` URL 改取 `new URL(u).pathname` 走 baseURL，避免打到线上/别的端口。 |
| `tests/e2e/f7-2-visual-review.spec.ts` | dev-only 的 8 个 dev-story 走查用例：`E2E_PROD_SERVER` 下 `test.skip`。 |
| `tests/e2e/f7-3-accessibility.spec.ts` | 同上，2 个 dev-story 用例在生产 server 下跳过。 |

## 3. 本地验证结果（都已通过）

- `pnpm typecheck`：通过。
- **next dev 全套**：71 通过 / 1 跳过 / 0 失败。
- **`E2E_PROD_SERVER=1` 模式**（复用 warm dev server 验证跳过逻辑）：61 通过 /
  11 跳过（dev-story）/ 0 失败。
- `seed:media` 的 sharp 离线路径（`CI=1` 或 `SEED_MEDIA_OFFLINE=1`）本地跑通、无网络。

**本地复现命令**（并行开发纪律：独立端口 + 独立 SQLite）：
```bash
cd payload-office-platform
rm -f e2e-verify.sqlite*
PAYLOAD_SECRET=ci-only-local SQLITE_URL=file:./e2e-verify.sqlite pnpm seed
SEED_MEDIA_OFFLINE=1 PAYLOAD_SECRET=ci-only-local SQLITE_URL=file:./e2e-verify.sqlite pnpm seed:media
PORT=3731 PAYLOAD_SECRET=ci-only-local SQLITE_URL=file:./e2e-verify.sqlite pnpm exec playwright test --reporter=list
# 验证跳过逻辑：加 E2E_PROD_SERVER=1（会复用已在 3731 跑的 dev server）
```

## 4. ⛔ 当前唯一阻塞：PG seed 迁移漂移（既有 bug，非本任务引入）

**现象**：CI `e2e` 作业在 **step 10 `Seed business data`（`pnpm seed`）** 失败，快速失败
（~60s，还没到 build/测试）。`quality` 作业（SQLite）**通过**。

**报错**（run 30436849573，e2e job 90526491252）：
```
DrizzleQueryError: Failed query: select distinct ... from "payload_locked_documents"
  left join "payload_locked_documents_rels" ... where (... "..."."audit_logs_id" = $24 ...)
cause: error: column <alias>.audit_logs_id does not exist  (code 42703 errorMissingColumn)
  at seed (scripts/seed.ts:985)  → payload.update({collection:'listings'})
  → checkDocumentLockStatus → deleteMany(payload_locked_documents)
```

**根因**（已定位）：
- Payload 配置里有 `AuditLogs`（slug `audit_logs`）collection，核心的
  `payload_locked_documents_rels` 表应为每个 collection 建一列 `<slug>_id`，
  因此需要 `audit_logs_id`。
- 但 **`src/migrations/` 里没有任何迁移定义 `audit_logs_id`**
  （`grep -rn audit_logs_id src/migrations` 无结果）。
- 本地/`quality` 作业用 **SQLite**，适配器按 config 自动同步 schema → 列存在 → 不报错。
- 生产/CI 用 **PostgreSQL**（`push:false`，只走显式迁移）→ 列缺失 → seed 里第一次
  `payload.update(...)` 触发文档锁检查查到该列 → 42703。
- 因此**任何 PG seed 都会失败**，包括仓库既有的 `postgres-migrations` 作业
  （它 step 10 `Populate existing business data` 也是 `pnpm seed`）。

**待确认（下一步第一件事）**：本次 run 里 `postgres-migrations` 作业当时仍在跑，
没走到 seed。跑一下确认它也在 seed 步失败，即可证明这是**既有漂移、与 E2E 改动无关**：
```bash
gh run view 30436849573 --json jobs --jq '.jobs[] | "\(.name): \(.status)/\(.conclusion)"'
gh run view 30436849573 --json jobs --jq '.jobs[]|select(.name=="postgres-migrations")|.steps[]|"\(.number). \(.name): \(.conclusion)"'
```

## 5. 建议修复路径

这是**迁移漂移**，应按 CLAUDE.md 纪律修（**迁移正文绝不可手改**，必须
`payload migrate:create` 生成）：

1. **首选**：在能连 PG 的环境，对齐 config 后生成补漏迁移：
   ```bash
   cd payload-office-platform
   # 用一个可写的 PG（本机 5432 有实例但归属不明，别乱用；建议 docker 起临时 PG）
   DATABASE_URL=postgres://...  pnpm exec payload migrate:create audit_logs_locked_docs_rel
   ```
   预期新迁移会 `ALTER TABLE payload_locked_documents_rels ADD COLUMN audit_logs_id ...`
   （可能还有别的 collection 缺列，一并补齐）。提交 `src/migrations/` 新文件。
2. **归属**：该 bug 属于 **OPT-021 分支（或更早）**，不是本 E2E 任务引入。理想做法是
   **在 `codex/opt-021-admin-navigation` 上修**（那样 OPT-021 自己的 `postgres-migrations`
   作业也能恢复绿），本 stacked PR 自然继承。若要就地在本分支修也可，但记得它是补
   OPT-021 的漏。
3. 修完后本地可用 docker PG 验证 `pnpm exec payload migrate && pnpm seed` 跑通，再推分支
   触发 CI。

**不要**：手写迁移正文去 ADD COLUMN（违反纪律，且列名/约束要精确匹配 Payload 生成规则，易错）。

## 6. E2E 作业设计的关键事实（改 `e2e` job 时别踩）

- **生产 fail-closed 守卫**（`src/lib/runtime/config-guard.ts`）：`next start`
  （NODE_ENV=production）首个请求会校验：① `DATABASE_URL` 以 `postgres` 开头
  ② `PAYLOAD_SECRET` 非弱且 **≥32 字符**（e2e job 用的是
  `ci-e2e-payload-secret-do-not-use-in-prod-0123456789`，别缩短）③ `NEXT_PUBLIC_SITE_URL`
  合法 https 非 localhost。三者已在 e2e job 的 env 配齐。
- **`site-config.ts`** 生产也 fail-closed，但只强依赖 `NEXT_PUBLIC_SITE_URL`（已给）。
- **baseURL 张力**：`NEXT_PUBLIC_SITE_URL` 必须是线上 https（过守卫），所以**不能**再
  拿它当 Playwright baseURL——已用 `PLAYWRIGHT_BASE_URL`/`localhost:PORT` 解耦。
- **`/dev-story` 生产 404**（`dev-story/page.tsx` `NODE_ENV==='production'` → `notFound()`）：
  是整个前端**唯一**的 prod/dev 分歧页；依赖它的走查用例已在 `E2E_PROD_SERVER` 下跳过。
- **媒体无 S3**：`@payloadcms/storage-s3` 不是依赖、无 s3Storage 插件，Media 走本地磁盘
  `upload:true`，`seed:media` 在 CI 无需云凭据。
- **有效供给精筛**要求 `gallery.length ≥ 3`（`effective-supply.ts` §6），否则前台 0 房源
  → 这是接 `seed:media` 的原因。
- 询盘限流 `failOpen:true`（`rate-limit-config.ts`），生产不会因限流拦测试。

## 7. 完成判据（收尾）

1. 修好 PG seed（第 5 节）后，CI `e2e` 作业能走完 seed → seed:media → build → next start
   → Playwright，**全绿**（admin-navigation 在 next start 下不再 10s 超时）。
2. `continue-on-error` 已在 d32fdea 删除（无需再动）。
3. 把 PR #7 从 draft 转正（在 OPT-021 合并后）。

## 8. 有用的命令

```bash
# 看 CI
gh pr checks 7
gh run view 30436849573 --json jobs --jq '.jobs[]|"\(.name): \(.status)/\(.conclusion)"'
# 抓某作业完整日志
gh api repos/JiayuanUXD/sbh/actions/jobs/<JOB_ID>/logs > /tmp/job.log
# 重跑失败作业
gh run rerun 30436849573 --failed
```
