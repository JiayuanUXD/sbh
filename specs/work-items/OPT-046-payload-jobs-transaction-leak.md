# Task Packet：OPT-046 Payload Jobs 定时轮询泄漏数据库事务

> 状态：**待排期**（已有止损，根因未修）
> 创建日期：2026-08-24
> 来源：2026-08-24 生产故障（打开 `PAYLOAD_DISABLE_JOB_AUTORUN` 后约 8 分钟线上半瘫）
> 编号说明：OPT-045 是批量导入覆盖面，故取 046

---

## 1. 一句话

Payload Jobs 的定时轮询每隔一段时间会**泄漏一个数据库事务**——连接停在
`idle in transaction`、PG 侧 `wait_event=ClientRead` 等一条永远不会来的
COMMIT/ROLLBACK。node-postgres 池默认 `max=10`，泄漏攒满就没有可用连接，
**所有要查库的请求无限排队**。

## 2. 故障经过（2026-08-24）

打开 `PAYLOAD_DISABLE_JOB_AUTORUN=0` 并全量 `sbh-105` 之后约 8 分钟：

| 路由 | 表现 |
|---|---|
| `/api/health` | **挂死，120s 超时** |
| `/shanghai/listings` | **挂死，120s 超时** |
| `/` | 200，0.23s |
| `/shanghai/buildings` | 200，0.27s |

**「一半页面好、一半页面死」就是这个缺陷的指纹**：能命中 Next 缓存的路由不碰连接池，
照常秒回；凡是要实时查库的（health 显式检查 db、listings 走有效供给实时查询）全部挂死。
很容易误判成「某几个页面坏了」。

处置：把 `PAYLOAD_DISABLE_JOB_AUTORUN` 改回 `1`（触发容器重启，顺带换掉被占满的池子），
约 1 分钟内恢复。**生产未回滚代码**，`sbh-105` 仍在线且健康。

## 3. 证据

### 3.1 生产（故障当时）

```
连接数 26/2048                      ← 数据库层面远没满，是应用池满
idle in transaction              8 个，最久 19 分钟
idle in transaction (aborted)    1 个
锁等待                            0
```

九个泄漏连接跑的是同一条语句：

```sql
select "payload_jobs"."id", "payload_jobs"."input", "payload_jobs"."completed_at",
       "payload_jobs"."total_tried", "payload_jobs"."has_error", ...
```

逐条明细：

```
backend_start == xact_start == last_activity     连上就开事务，跑完 SELECT 就不动了
wait_event: Client / ClientRead                  PG 在等客户端，客户端再没说话
xact_start: 23:53:30 / 23:56:00 / 23:57:30 / 23:58:00 / 00:01:00 …
```

时间点**全部对齐 `:00` 与 `:30`**，与 `payload.config.ts` 里
`*/30 * * * * *` 的 autoRun cron 节拍完全吻合。

另有一个 `idle in transaction (aborted)`，卡在
`insert into "payload_jobs_log" (...)` —— 说明还有一条「日志写入失败后事务未回滚」的路径，
可能是同一个 bug 的另一面，也可能是独立问题。

### 3.2 本地（同样复现，但速率低两个数量级）

```
idle in transaction 5 个，xact_start 分布在 01:19 / 05:03 / 08:49 / 12:29 / 19:31
最久接近 2 天
+ 1 个 payload_jobs_log 插入失败的 aborted 事务
```

**签名与生产完全一致**，且这些是跨越好几天的开发会话累积下来的。

推论：

1. **这不是新缺陷**，也不是今天任何一个 PR 引入的；
2. **不是每个 tick 都泄漏**（否则本地会有几百个）；
3. 速率与**数据库延迟正相关**——本地 localhost 亚毫秒、19 小时漏 5 个；
   生产走公网 TencentDB、8 分钟漏 9 个。合理猜测是 tick 之间发生重叠时才泄漏，
   延迟越高越容易重叠。**这条尚未证实，是本工作项要查的第一件事。**

### 3.3 `PAYLOAD_DISABLE_JOB_AUTORUN` 大概率本来就是为它存在的

`DEPLOYMENT.md:192` 只说这个开关是建通知唯一索引的高风险窗口用来临时暂停队列的。
但生产上它一直是 `1`，而本工作项证明一旦打开、几分钟内就会半瘫。
**这个开关的真实作用从未被写下来。**

## 4. 已做的止损（不是修复）

分支 `fix/pg-idle-in-transaction-timeout-8e21`：

1. **`idle_in_transaction_session_timeout=120000`** 加到 `payload.config.ts` 的 pool 配置。
   泄漏照旧发生，但 PG 会自己回收超时的空闲事务，池子打不满。
   取值 120s 的理由：正常事务里两条语句之间的空闲远小于此；空闲超过两分钟的事务本身就是缺陷。
   只管「事务内空闲」，正在执行的长语句（如迁移）不受影响。

2. **`lib/runtime/pool-error-handler.ts`** —— 这是第 1 条能安全启用的前提，
   本身也修掉一个独立的潜伏缺陷。

   `node-postgres` 的 `Pool` 继承 `EventEmitter`，连接出错会 `pool.emit('error')`；
   EventEmitter 的 `'error'` 没有监听者就直接 throw，在 Node 里等于进程退出、容器崩溃。
   而 `@payloadcms/db-postgres` / `@payloadcms/drizzle` **都没有挂这个处理器**（全仓 grep 确认）。
   也就是说在此之前，**任何连接级错误——网络抖动、TencentDB 主备切换、数据库重启——
   都会崩容器**，与 job 泄漏无关。

   实测（本地真库）：不挂处理器时连接被回收即进程退出；挂上之后
   `pool 的 error 监听者数量 = 1` → PG 回收（`25P03`）→ 记一条
   `pg_pool_client_error` 日志 → **进程存活、池子仍可用**。

**止损不等于修复**：泄漏还在，只是不再能打满池子。

## 5. 已排除的假设（2026-08-24 实验，别再重复走这两条路）

### 5.1 ❌「`updateJob.js` 缺 try/catch，出错即泄漏」——**已证伪**

源码确实有缺陷。`queues/utilities/updateJob.js` 里：

```js
const jobReq = { transactionID: await req.payload.db.beginTransaction() }
const updatedJobs = await req.payload.db.updateJobs(args)   // 抛错就到不了下一行
if (...) { await req.payload.db.commitTransaction(jobReq.transactionID) }
```

全文没有 `try` / `catch` / `finally`，也从不调 `killTransaction`。看起来完全吻合。

**但实验否定了它。** 做法：注入一个必定抛错的 `db.updateJobs`，调用 `updateJob`，
再数 `pg_stat_activity` 里的泄漏事务。

- 第一版：错误抛得太早——drizzle 的 `beginTransaction()` 只建会话，
  **真正的 `BEGIN` 要到首次在该事务上执行语句时才发给 PG**。物理事务没开，自然不漏。
  （这条本身值得记住，它让「读源码得出的结论」很容易假阳性。）
- 第二版：先在事务会话上真跑一条 `select 1` 再抛错。**泄漏数仍然纹丝不动（6 → 6）。**

结论：这个缺陷是真的，但**不是本次泄漏的触发路径**。修它（`runHooks: true` 或打 patch）
解决不了问题。

> 顺带：`jobs.runHooks: true` 确实能绕开这条快速路径、改走事务处理完整的
> `payload.update()`，但 Payload 官方注释写着「discouraged，drastically affect
> performance」且 `@deprecated - will be removed in 4.0`。在根因未明前不要拿它当解药。

### 5.2 ❌「进程被强制终止会遗留在途事务」——**已证伪**

做法：记录泄漏数 → `taskkill /F` 硬杀本地 dev server → 等 6 秒 → 再数。
结果 **6 → 6，没有新增**。TCP 连接被 RST 后 PG 会清掉会话，不构成泄漏来源。

### 5.3 关键的反向证据：cron tick 本身不泄漏

2026-08-24 本地 dev server 连续运行约 90 分钟，三条 cron（30s/30s/10s）打了上百轮，
**泄漏数全程停在 5-6 没有增长**。而生产是在**流量从 10% 切到 100% 的那 8 分钟里**漏了 9 个。

所以触发条件是**情境性**的，不是「每轮轮询都漏」。

## 5.4 下一步该查什么（按可能性排序）

1. **多实例并发争抢同一队列**。生产切流量时新旧版本实例可能并存，
   各自按同一 cron 轮询同一张 `payload_jobs`；`updateJobs` 取任务要加锁，
   争抢路径上可能有不释放的分支。本地单实例复现不出来，正好解释速率差异。
   验证思路：本地同时起 2-3 个进程指向同一个库，跑 30 分钟看泄漏是否增长。
2. **`payload_jobs_log` 插入失败**那条 `idle in transaction (aborted)`——
   本地与生产各有一个，签名一致，是唯一能直接看到「事务已进入 aborted 却没回滚」的样本。
   查清它为什么失败，很可能顺藤摸到主路径。
3. 把三条 autoRun 的 `silent: true` 关掉再复现，看有没有被吞掉的错误。
4. 以上都不成立时，再读 `runJobs/index.js` 与 drizzle 适配器的
   `beginTransaction` / `commitTransaction` 实现，找有没有「会话被丢弃但连接没归还」的路径。

## 6. 验收

- 打开 `PAYLOAD_DISABLE_JOB_AUTORUN=0`，在生产形态（公网延迟）下连续运行 ≥ 30 分钟，
  `pg_stat_activity` 里 `idle in transaction` **不增长**；
- `/api/health` 与 `/shanghai/listings` 全程 200 且响应时间无劣化；
- 关掉 `silent: true` 后，日志里不再出现被吞掉的 job 错误。

## 7. 坑

- **别用「首页还好」来判断服务健康。** 这个缺陷下 `/` 和 `/shanghai/buildings`
  一直是 200 且秒回（走 Next 缓存），而 `/api/health` 已经挂死。
  健康检查必须打真正查库的路由。
- **别在没有 pool error 处理器的前提下加任何会导致连接被服务端终止的配置**
  （`idle_in_transaction_session_timeout`、`statement_timeout`、连接空闲回收等），
  那会把降级变成崩溃循环。第 4 条的两项必须成对存在。
- **OPT-041 批量导入在生产依赖 job 队列**。本工作项修好之前，
  `PAYLOAD_DISABLE_JOB_AUTORUN` 只能保持 `1`，也就意味着**批量导入在生产不可用**
  ——这同时是 OPT-045 的前置条件。

## 7.5 顺带发现（独立问题，可单独立项）：迁移快照链已回退

修本工作项时用 `payload migrate:create` 探测「本次改动有无 schema 影响」，
它却生成了一个**与 `20260820_110024_opt035_city_profile_avg_response_hours`
一模一样**的迁移（`ALTER TABLE city_site_profiles ADD COLUMN avg_response_hours numeric`）。

查下来是快照链回退了：

| 快照 | 含 `avg_response_hours` |
|---|---|
| `20260820_110024_opt035_city_profile_avg_response_hours.json` | **有**（2 处） |
| `20260821_161534_supply_import_batches.json` | **0** |
| `20260822_010308_supply_import_job_task.json` | **0** |

后面两个（OPT-041 的）快照丢掉了前一个快照已有的列，说明
**OPT-041 的迁移是基于一个早于 `20260820_110024` 的旧基线生成的**。

另外 `20260822_001600` 与 `20260822_001700` 两个迁移**根本没有配套 `.json` 快照**。

后果有两层：

1. **任何人现在跑 `migrate:create` 都会凭空多出一个重复迁移**，
   而那条 `ADD COLUMN` 没有 `IF NOT EXISTS`，一旦被误提交并部署，
   会在已有该列的库上直接失败——与今天的故障是同一种死法。
2. **这就是今天生产故障的产生机制**：`migrate:create` 拿快照 diff，
   快照既然停留在旧基线、又不知道生产早已存在 `buildings.data_source_*`，
   自然发出裸的 `CREATE TYPE`。PR #86 修的是症状，这里才是病灶。

修法方向（需单独排期）：以当前生产 schema 为准重新生成一份权威快照，
并给 `20260822_001600` / `001700` 补上；同时考虑在 CI 加一道
「`migrate:create` 探测必须报 no changes」的守卫，让快照漂移在 PR 阶段就暴露。

## 8. 相关

- `payload-office-platform/src/payload.config.ts`：jobs 配置与 pool 配置
- `payload-office-platform/src/lib/runtime/pool-error-handler.ts`：止损第 2 项
- `specs/work-items/OPT-045-bulk-import-publishable-coverage.md`：被本工作项阻塞
- `DEPLOYMENT.md:192`：`PAYLOAD_DISABLE_JOB_AUTORUN` 现有的（不完整的）说明
