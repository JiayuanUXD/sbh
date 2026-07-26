# OPT-016 CI/CD 质量门禁与渐进发布 · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md` P1 第一项
> 完成标准：锁定工具版本；发布前质量门通过；迁移单次执行；支持灰度、冒烟和回滚

## 审查发现

`.github/workflows/deploy.yml`（修复前）：

- 无 lint / typecheck / test / build / 迁移预检--推送即部署，发布工作流绕过项目质量门禁。
- `npm install -g @cloudbase/cli@latest`--工具版本漂移，CLI 行为变化可无声破坏部署。
- `tcb cloudrun deploy --force` 后直接全量切流量--无灰度、无冒烟、无回滚。
- 单实例迁移（`payload migrate`）：多实例并发拉起时无互斥，存在并发迁移踩 schema 冲突的风险。
- 冒烟仅一次 `/api/health`，首页 `/` 未验证。

## 修复内容

### 1. 质量门 job（`.github/workflows/deploy.yml` quality job）

发布前在 CI runner 上依次跑：

| 步骤 | 命令 | 失败行为 |
| --- | --- | --- |
| Lint | `pnpm lint` | quality 失败 -> deploy 不跑 |
| Typecheck | `pnpm typecheck` | 同上 |
| 单元测试 | `pnpm test` | 同上 |
| 迁移预检 | `pnpm exec tsx scripts/preflight.ts migrations` | 同上（OPT-014 守卫） |
| 构建 | `pnpm build` | 同上（验证可构建，产物留 quality runner 不进 ZIP） |

quality 与 deploy 是独立 job（`deploy.needs: quality`），各自 checkout 干净源码：quality 的 `.next` 产物不污染 deploy 上传的 source ZIP。

### 2. 锁定 CLI 版本

```yaml
- name: Install CloudBase CLI（锁版本，避免 @latest 漂移破坏命令语义）
  run: npm install -g @cloudbase/cli@3.6.4
```

`@latest` -> `@3.6.4`。`tcb cloudrun traffic` 命令自 v3.0.0 提供，3.6.4 满足。

### 3. 迁移单次执行（PG advisory lock 互斥）

#### 纯函数 `src/lib/runtime/migrate-lock.ts`

`runMigrateLocked(opts)` 注入依赖（`tryAcquire` / `release` / `runMigrate` / `sleep` / `now` / `maxWaitMs` / `pollMs` / `onStatus`），返回 `'acquired' | 'timeout'`：

- 轮询 `tryAcquire` 直到拿到锁或超过 `maxWaitMs`；
- 拿到锁后跑 `runMigrate`，`finally` 释放锁（迁移抛错也释放，错误向上抛）；
- 超时返回 `'timeout'`，不跑迁移、不释放；
- `release` 抛错被吞（不影响迁移结果）。

#### 入口脚本 `scripts/migrate-locked.ts`

- `payload.init({ config })`（**不**设 `disableOnInit`，让 OPT-015 config-guard 在迁移前 fail-closed）；
- 经 `payload.db.pool.connect()` 拿专用连接（session-level advisory lock 需独占连接跨操作持有）；
- `pg_try_advisory_lock($1)`，`LOCK_ID = 0x53424d47`（'SBMG'），`MAX_WAIT_MS = 180_000`，`POLL_MS = 3_000`；
- 拿到锁 -> `db.migrate()` -> `finally` `pg_advisory_unlock` + 释放连接；
- 失败 `process.exit(1)`。

多实例并发拉起：第一个实例拿锁跑迁移，其余实例轮询等待；锁释放后它们跑幂等 skip（Payload 迁移表记录已执行版本）。

#### Dockerfile CMD（`Dockerfile` L55）

```dockerfile
CMD ["sh", "-c", "pnpm exec tsx scripts/migrate-locked.ts && pnpm start"]
```

原 `pnpm exec payload migrate` -> `pnpm exec tsx scripts/migrate-locked.ts`。

### 4. 渐进发布：灰度 -> 冒烟 -> 全量/回滚（deploy job）

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| 部署新版本 | `tcb cloudrun deploy -s sbh --source ... --port 80 --force` | 默认发布为灰度版本，流量 0%；失败保护：新版本创建/构建/启动失败时不进灰度，旧版本继续承接 |
| 切 10% 灰度 | `tcb cloudrun traffic -s sbh --stable 90 --canary 10` | sleep 30s 等容器启动 + migrate-locked 跑完 |
| 冒烟 | curl `/api/health` x10 + `/` x1 | 要求全 200 且 health 含 `"status":"ok"` |
| 全量 | `tcb cloudrun traffic promote -s sbh` | `if: success()` |
| 回滚 | `tcb cloudrun traffic rollback -s sbh` | `if: failure()`，切回稳定版本 |

命令语法来源：[CloudBase CLI 灰度流量管理](https://docs.cloudbase.net/cli-v1/cloudrun/traffic)（`tcb cloudrun traffic` 自 v3.0.0 起，仅上海地域；本服务域名 `sh.run.tcloudbase.com` 即上海）。

`printf '\n\n\n' | tcb ...` 喂回车规避"是否启用灰度部署"list 提示（CI 无 tty 会 exit 130），保留原 CI 三连坑修复。`concurrency.cancel-in-progress: false` 保留，部署互斥排队。

## 验证

### 单元测试

```
pnpm exec vitest run tests/migrate-lock.test.ts
```

6 项通过，覆盖：

| 场景 | 期望 |
| --- | --- |
| 首次拿到锁 | `acquired`；调 `runMigrate` + `release`；不 `sleep` |
| 首次失败第二次成功 | `acquired`；`sleep(100)` 一次 |
| 一直拿不到锁且超时 | `timeout`；不调 `runMigrate` / `release`；`tryAcquire` + `sleep` 各 2 次 |
| 迁移抛错 | 错误向上抛；`release` 仍被调（finally） |
| `release` 抛错 | 不影响结果（仍 `acquired`） |
| `onStatus` 回调 | `retry` + `acquired` 被通知 |

### 全量回归

```
pnpm test       # 101 文件、1938 项通过（+6 migrate-lock）
pnpm typecheck  # exit 0
```

### 工作流语法

`.github/workflows/deploy.yml` 为纯 YAML 重写，无动态生成；quality / deploy 两 job 依赖关系、`if: success()` / `if: failure()` 分支、`concurrency` 均为 GitHub Actions 原生语义。

## 完成标准对照

| 标准 | 证据 |
| --- | --- |
| 锁定工具版本 | `@cloudbase/cli@3.6.4`（deploy.yml Install CloudBase CLI 步骤） |
| 发布前质量门通过 | quality job：lint + typecheck + test + preflight:migrate + build，`deploy.needs: quality` |
| 迁移单次执行 | `migrate-locked.ts`（PG advisory lock 互斥）+ `migrate-lock.test.ts` 6 项 + Dockerfile CMD |
| 支持灰度 | `cloudrun deploy`（0%）-> `traffic --stable 90 --canary 10` |
| 支持冒烟 | smoke 步骤：`/api/health` x10 + `/` x1，全 200 且 `status:ok` |
| 支持回滚 | `cloudrun traffic rollback`，`if: failure()` 自动触发 |

## 灰度/回滚流程

```
push master
  │
  ▼
quality job (lint/typecheck/test/preflight/build)
  │ 失败 ───────────────────> 不部署
  ▼ 通过
deploy job
  │
  ├─ deploy 新版本（灰度 0%）
  │     失败保护：新版本没起来则不进灰度，旧版本继续
  │
  ├─ sleep 30s + traffic --stable 90 --canary 10
  │
  ├─ smoke (/api/health x10 + /)
  │     │
  │     ├ 通过 ─> traffic promote 全量 ─> ✅
  │     │
  │     └ 失败 ─> traffic rollback ─> ❌ exit 1
  │
  └─ promote 失败 ─> traffic rollback ─> ❌ exit 1
```
