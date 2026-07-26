# OPT-017 分布式限流与资源上限 · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md` P1 第二项
> 完成标准：多实例共享原子额度、TTL 回收、容量保护及失败策略有测试

## 审查发现

`src/app/api/inquiries/route.ts` 限流使用进程内全局 `Map`（`src/lib/rate-limit.ts`）：

- CloudRun 多实例之间不共享计数，重启或扩容即重置额度--同一 IP 换实例即可绕过配额；
- `Map` 中过期 key 无清理机制，攻击者持续制造不同 IP 哈希可无限占用内存；
- 无总容量上限，无存储不可用时的失败策略。

只能作为单进程弱保护，不能满足生产批量接口限额与滥用防护。

## 修复内容

### 1. 纯函数核心（`src/lib/rate-limit-distributed.ts`）

| 导出 | 作用 |
| --- | --- |
| `computeWindowStart(now, windowMs)` | 固定窗口对齐（同窗口共享 windowStart） |
| `computeRetryAfterSeconds(windowStart, windowMs, now)` | 当前窗口剩余秒数（向上取整） |
| `evaluateAcquired(acquired, opts)` | 根据原子递增返回的计数决定放行/拒绝 + remaining |
| `shouldPrune(now, lastPruneAt, intervalMs)` | 是否触发 TTL 清理 |
| `checkCapacity(currentKeyCount, maxKeys, keyExists)` | 容量保护决策（allow / prune_first） |
| `decideOnStoreFailure(failOpen)` | 存储不可用时的失败策略 |
| `runDistributedRateLimit(deps, config, key, pruneRef)` | 协调器：TTL -> 容量 -> 原子递增 -> 决策，失败走 fail 策略 |

协调器依赖注入（`acquire` / `pruneExpired` / `countKeys` / `keyExists` / `now`），PG 适配器实现，测试用 mock。

### 2. PG 适配器（`src/lib/rate-limit-pg.ts`）

`createPgRateLimitDeps(pool)` 返回 `RateLimitDeps`，用 `INSERT ... ON CONFLICT` 单语句原子递增：

```sql
INSERT INTO inquiry_rate_limit (key, window_start, count, updated_at)
VALUES ($1, $2, 1, NOW())
ON CONFLICT (key) DO UPDATE
  SET count = CASE WHEN inquiry_rate_limit.window_start = $2 THEN inquiry_rate_limit.count + 1 ELSE 1 END,
      window_start = CASE WHEN inquiry_rate_limit.window_start = $2 THEN inquiry_rate_limit.window_start ELSE $2 END,
      updated_at = NOW()
RETURNING count, window_start
```

- key 不存在 -> 插入 count=1；
- key 存在且窗口匹配 -> count+1；
- key 存在但窗口过期 -> 重置 count=1 + 新 windowStart。

单语句原子，多实例并发安全。`pruneExpired` 删 `window_start < cutoff`，`countKeys`/`keyExists` 支持容量检查。

### 3. 建表迁移（`src/migrations/20260726_150000_opt017_inquiry_rate_limit.ts`）

```sql
CREATE TABLE "inquiry_rate_limit" (
  "key" varchar PRIMARY KEY NOT NULL,
  "window_start" bigint NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "inquiry_rate_limit_window_start_idx" ON "inquiry_rate_limit" USING btree ("window_start");
CREATE INDEX "inquiry_rate_limit_updated_at_idx" ON "inquiry_rate_limit" USING btree ("updated_at");
```

已注册到 `src/migrations/index.ts`（现 19 个迁移）。`window_start` 索引支撑 TTL 清理。

### 4. route.ts 集成

- 移除进程内 `Map` + `checkRateLimit`，改用 `runDistributedRateLimit(pgDeps, RATE_LIMIT_CONFIG, rateKey, ratePruneRef)`；
- `getPayload` 提前到限流前以拿 `payload.db.pool`（单例，后续调用廉价）；
- 配置：`windowMs=60s, max=5, maxKeys=100_000, pruneIntervalMs=5min, failOpen=true`；
- `ratePruneRef` 模块级共享，跨请求保留上次清理时间；
- 旧 `src/lib/rate-limit.ts` + `tests/rate-limit.test.ts` 已删除（无生产引用）。

### 失败策略

`failOpen=true`：PG 不可用时放行，记 `rate_limit_store_unavailable_fail_open` 告警日志，依赖下游幂等键 + schema 校验兜底。询盘是公开提交端点，优先可用性（与 route.ts 幂等检查失败的"继续创建"策略一致）。`failOpen=false` 场景（强配额）由 `decideOnStoreFailure` 支持但未启用。

## 验证

### 单元测试（纯函数 + 协调器）

```
pnpm exec vitest run tests/rate-limit-distributed.test.ts
```

20 项通过，覆盖：

| 类别 | 场景 |
| --- | --- |
| 窗口对齐 | 边界值落在正确窗口起始 |
| 重试秒数 | 剩余 ms 向上取整；超窗口返回 0 |
| 放行决策 | count<=max 放行 + remaining；count>max 拒绝 + retryAfter |
| TTL 触发 | 达间隔触发 prune + 更新时间戳；未达不触发 |
| 容量保护 | key 已存在 allow；未达上限 allow；达上限 + 新 key prune_first |
| 失败策略 | failOpen=true 放行；false 拒绝 |
| 协调器 happy path | 新 key 计数 1 放行 |
| 协调器超配额 | count=6 拒绝 |
| 协调器容量保护 | key 不存在 + 达上限 -> 触发 prune；key 已存在 -> 不触发 |
| 协调器存储失败 | acquire/keyExists 抛错 -> fail-open 放行 / fail-closed 拒绝 |

### 集成测试（route.ts 真实路径 + mock PG deps）

```
pnpm exec vitest run tests/inquiry-api-route.test.ts
```

30 项通过。`vi.mock('@/lib/rate-limit-pg')` 注入进程内 deps（Map 模拟 PG 原子递增语义），验证限流路径：超过 5 次/分钟 -> 429 + Retry-After；不同 IP 互不影响。

### 全量回归

```
pnpm test       # 101 文件、1953 项通过
pnpm typecheck  # exit 0
pnpm exec tsx scripts/preflight.ts migrations  # 19 迁移，0 失败
```

## 完成标准对照

| 标准 | 证据 |
| --- | --- |
| 多实例共享原子额度 | PG `INSERT...ON CONFLICT` 单语句原子递增（rate-limit-pg.ts）；`evaluateAcquired` 测试 |
| TTL 回收 | `shouldPrune` + `pruneExpired` 删过期窗口；`runDistributedRateLimit` TTL 触发测试 |
| 容量保护 | `checkCapacity` + `maxKeys=100_000`；新 key 写入前检查 + prune_first 测试 |
| 失败策略有测试 | `decideOnStoreFailure` + 协调器存储失败 fail-open/fail-closed 测试 |

## 运行时路径

```
POST /api/inquiries
  │
  ├─ rateKey = hashIpForLog(ip, dailySalt)  // 不存原始 IP
  │
  ├─ runDistributedRateLimit(pgDeps, config, rateKey, pruneRef)
  │     │
  │     ├─ shouldPrune? -> pruneExpired(windowStart - windowMs)  // TTL
  │     │
  │     ├─ keyExists? 否 -> countKeys -> checkCapacity -> prune_first? pruneExpired  // 容量
  │     │
  │     ├─ acquire(key, windowStart)  // 原子递增（INSERT...ON CONFLICT）
  │     │     抛错 -> decideOnStoreFailure(failOpen=true) -> 放行 + 告警
  │     │
  │     └─ evaluateAcquired -> allowed? denied=429+Retry-After
  │
  ▼
  放行 -> 同源/CT/body 校验 -> schema -> 幂等 -> 建 Lead
```
