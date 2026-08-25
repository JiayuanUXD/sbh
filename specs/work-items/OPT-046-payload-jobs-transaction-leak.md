# Task Packet：OPT-046 Payload Jobs 定时轮询泄漏数据库事务

> 状态：**已验收**（2026-08-25 切流量下实测 23 次真实争抢、泄漏 0；见 §6.6。上游 issue #17912 修复后可撤 patch）
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

   **必须同时挂 pool 和 client 两条监听**。第一版只挂了 `pool.on('error')`，
   多进程复现里 `pg_pool_client_error` **一次都没触发**，三个进程全部以
   `throw er; // Unhandled 'error' event` 崩溃——因为泄漏的连接是**已借出但被遗弃**的，
   被 `idle_in_transaction_session_timeout` 回收时错误 emit 在 **Client** 实例上，
   **不经过 pool**。补上 `pool.on('connect', client => client.on('error', ...))` 后：

   | 复现进程 | 已退出 | 接住的连接错误 | 未处理的 error 事件 |
   |---|---|---|---|
   | fix-1 | 0 | 8 | 0 |
   | fix-2 | 0 | 4 | 0 |
   | fix-3 | 0 | 12 | 0 |

   日志形态：`scope: "client"` / `pgCode: "25P03"` / `由于空载事务超时而终止连接`，
   泄漏在约 120 秒后自动回收、进程存活、池子仍可用。

   > **这条是真实的踩坑**：只加超时 + 只挂 pool 处理器，会把「连接池被泄漏拖垮」
   > 换成「每回收一次崩一次容器」——比原缺陷更糟。两条监听必须同时存在。

**止损不等于修复**：泄漏还在（根因见 §5），只是不再能打满池子、也不再崩进程。

## 5. 根因（2026-08-24 多进程复现已确认）

### 5.1 完整链条

```
多进程/多实例并发 → 两个 runner 的 cron 同时轮询同一张 payload_jobs，抢同一个 job
  → 落败方的 UPDATE ... WHERE id = <已被对方改走的 job> 影响 0 行
  → @payloadcms/drizzle upsertRow/index.js:108
      const docs = await drizzle.update(...).returning(...)   // docs = []
    upsertRow/index.js:109
      transform({ data: docs[0] })                            // data = undefined
  → transform/read/index.js:36
      TypeError: Cannot use 'in' operator to search for '_rels' in undefined
  → @payloadcms/drizzle updateJobs.js:39 抛出
  → payload queues/utilities/updateJob.js:108 —— 该函数只有 beginTransaction，
    没有 try / catch / finally，也从不 killTransaction
  → 事务既不 commit 也不 rollback，连接停在 idle in transaction 且永不归还
```

现场堆栈（本地 `repro-3` 进程日志，2026-08-24 11:0x）：

```
TypeError: Cannot use 'in' operator to search for '_rels' in undefined
    at transform (@payloadcms/drizzle/src/transform/read/index.ts:36)
    at upsertRow  (@payloadcms/drizzle/src/upsertRow/index.ts:180)
    at updateJobs (@payloadcms/drizzle/src/updateJobs.ts:39)
    at updateJob  (payload/src/queues/utilities/updateJob.ts:108)
    at runJob → runJobs → Cron
```

复现方法（可重跑）：`scripts/repro-job-runner.ts`，起 **3 个**进程指向同一个库，
用 `PGAPPNAME` 区分归属：

```bash
PGAPPNAME=repro-1 node --env-file-if-exists=.env.local --import tsx scripts/repro-job-runner.ts
```

约 2 分钟内即可看到 `pg_stat_activity` 里 `idle in transaction` 按进程增长
（实测 `repro-1=2 repro-2=4 repro-3=1`）。**单进程复现不出来**——这正是
§5.3「本地单实例 90 分钟不漏、生产切流量 8 分钟漏 9 个」的原因：
生产在 10%→100% 切流量时新旧版本实例并存，构成并发争抢。

### 5.2 为什么此前两次实验把它误判成「已证伪」

这两次实验是**设计错误**，不是结论。留档避免重走：

- **实验一**：整体替换 `db.updateJobs` 让它抛错。第一版错误抛得太早——drizzle 的
  `beginTransaction()` 只建会话，**真正的 `BEGIN` 要到首次在该事务上执行语句时才发给 PG**，
  物理事务没开当然不漏。第二版补了 `select 1` 再抛，泄漏数仍 6→6。
  **错在哪**：真实错误发生在 `db.updateJobs` **内部**（`upsertRow` 里），
  而我把整个 `updateJobs` 换掉了，恰好绕开了真正会开事务的那段语句。
- **实验二**：`taskkill /F` 硬杀 dev server，6→6 无新增。这条结论本身没错
  （TCP RST 后 PG 会清会话），只是它排除的不是主路径。

教训：**只读源码得出的「吻合」很容易假阳性，但注入式实验若没打在真实抛错的那一层，
得出的「证伪」同样是假的。** 判据要落在真实堆栈上，不是构造出来的等价物。

### 5.3 关键的情境性证据（仍然成立）

2026-08-24 本地单进程 dev server 连续运行约 90 分钟，三条 cron（30s/30s/10s）
打了上百轮，**泄漏数全程停在 5-6 没有增长**。而生产是在**流量从 10% 切到 100%
的那 8 分钟里**漏了 9 个。触发条件是并发，不是「每轮轮询都漏」。

### 5.4 修复：`pnpm patch` + 上游 issue（2026-08-24 已做）

**先说一个反直觉的事实：升级 payload 解决不了这个问题。** 核实的是发布产物本身，
不是 changelog：

| 版本 | drizzle 原子认领（`processingToken`，#17441） | `updateJob.js` 有 try/catch |
|---|---|---|
| 3.86.0（我们在用） | ❌ | ❌ |
| 3.88.0（`latest`） | ❌ | ❌ |
| 4.0.0-canary.29 | ✅ | **❌** |

- #17441 修的是争抢竞态（#16043），但它是 `feat!`，**只在 4.0 分支，任何 3.x 发布版都没有**。
- 缺 try/catch 本身**连 4.0-canary 都没修**。4.0 只消掉「争抢」这一个触发器，
  其它路径（jobs-log 写失败、瞬时 DB 错误、连接中断）照样会泄漏——
  上游 #17645 从另一个入口撞上同一个 TypeError，结论一致。

所以 patch 是目前唯一的解，不是权宜之计。

**已做**：

1. **`patches/payload@3.86.0.patch`** —— 给 `queues/utilities/updateJob.js` 的
   `db.updateJobs()` 包一层 try/catch：出错先 `rollbackTransaction` 再重抛。
   **不吞错、不改错误语义**，只堵泄漏；TypeError 照常向上传，由 `autoRun` cron
   自带的 `catch` 选项记日志。

2. **`tests/payload-updatejob-patch.test.ts`** —— 直接读 `node_modules` 里的实际产物
   断言 patch 在位。patch 没有任何编译期保护，升级 payload 时 pnpm 会因版本号变化
   直接丢掉它，而症状只在生产切流量的几分钟里出现，本地稳态复现不出来。
   已反向验证：去掉 patch 4 条全红。

3. **上游 issue [payloadcms/payload#17912](https://github.com/payloadcms/payload/issues/17912)**
   —— 含完整堆栈、三进程复现步骤、跨版本核实结论与建议补丁。

**实测对照**（同一套三进程复现）：

| | patch 前 | patch 后 |
|---|---|---|
| 争抢触发 TypeError | 有 | **有（4 次，触发条件不变）** |
| 泄漏事务峰值 | 11 | **0** |
| 进程存活 | **0/3**（全崩） | **3/3** |
| 靠 120s 超时兜底回收 | 24 次 | **0 次（压根没泄漏）** |

`pg_pool_client_error` 一次都没触发——因为连接根本没泄漏，超时兜底无事可做。
§4 的两条止损从此退居为**纵深防御**：真正堵住泄漏的是这个 patch。

**仍未解决（上游侧）**：`upsertRow` 在 0 行时对 `docs[0]=undefined` 调 `transform` 必抛。
并发争抢下 0 行是**正常结果**，语义上就不该抛。已在 #17912 里提出，可另开 issue。

> `jobs.runHooks: true` 已排除。它确实能绕开这条快速路径、改走事务处理完整的
> `payload.update()`，但 Payload 官方注释写着「discouraged，drastically affect
> performance」且 `@deprecated - will be removed in 4.0`。

## 6. 验收

**本地（快，先过这关）**：起 3 个 `scripts/repro-job-runner.ts` 进程指向同一个库，
跑 ≥ 10 分钟：

- 日志里**应当**出现 `Error in job queue cron job handler` + `Cannot use 'in' operator`
  ——这说明争抢确实发生了，触发条件成立。**没有它反而说明没测到。**
- `pg_stat_activity` 里 `idle in transaction` **全程为 0**；
- 三个进程全部存活。

（2026-08-24 实测：4 次争抢，泄漏 0，3/3 存活。）

**生产**：打开 `PAYLOAD_DISABLE_JOB_AUTORUN=0`，并且走一次 **10% → 100% 切流量**
（新旧实例并存才是真实触发条件，稳态单实例复现不出来），连续运行 ≥ 30 分钟：

- `idle in transaction` 不增长；
- `/api/health` 与 `/shanghai/listings` 全程 200 且响应时间无劣化；
- 关掉 `silent: true` 后，日志里不再出现被吞掉的 job 错误。

## 6.5 生产验收结果（2026-08-24）

线上 `aa84a26` / `sbh-108`，`PAYLOAD_DISABLE_JOB_AUTORUN="0"`，两个实例并发轮询。

| 项 | 结果 |
|---|---|
| 健康探针（15s × 352 次，约 90 分钟） | 0 次非 200，`status=ok` / `db=ok` 全绿，0.05–0.19s |
| `idle in transaction` | **全程 0** |
| Job 全链路 | 13 个 job（1 + 12 负载）全部处理完毕，`has_error=0`，生成 39 条站内通知后出队 |
| 容器日志中的 cron 错误 / `_rels` TypeError / `pg_pool_client_error` | **0 条** |

**但这不等于「patch 在生产被验证过」**——0 条错误说明**争抢没有发生**，不是发生了被接住。
12 个 job 分 4 轮灌入仍未触发，说明生产的争抢窗口比预想窄得多：
真实错误要求「赢家完成并**删除** job 行」发生在「输家的 UPDATE」之前
（`deleteJobOnComplete` 默认开启，行没了 → 0 行 → `docs[0]` undefined）。
通知任务执行极快，这个窗口只在**部署重叠 / 实例数变化**时才明显放大——
与 §5.3「稳态不漏、切流量 8 分钟漏 9 个」完全吻合。

因果证明仍然只有本地三进程复现（§5.1，带完整堆栈）。生产侧的结论是：
**已具备可观测性，真发生了一定看得见**（判据见下），且常态运行无泄漏。

### 怎么查生产日志（踩过的坑）

应用日志**在** CLS 里，`stdout` 和 `stderr` **都采**（`CustomLogs: "stdout"` 的语义是
采集路径而非只采 stdout；实测 stderr 有 `__TAG__.stream: "stderr"` 的记录）。

**坑：容器名是版本名（`sbh-108`），不是服务名（`sbh`）。** 按 `container_name:"sbh"`
查恒为空，会误判成「生产没有应用日志」。另外 `NOT container_name:"xxx"` 这种否定过滤
不按预期生效。

```
queryLogs(action=searchLogs, service=tcbr,
          queryString='"job queue cron" OR "_rels" OR "pg_pool_client_error"',
          startTime=..., endTime=...)
```

**「查不到」必须先做对照**：拿一条已知存在的日志（如 `"can not be cached"`，
16:12 那条 stderr）在它自己的时间窗里查一次，命中了才能把空结果当真阴性。

**坑（2026-08-25 新踩）：查询短语太长会恒零命中。** 同一时间窗里：

| 查询串 | 命中 |
|---|---|
| `"Error in job queue cron job handler"` | **0** ← 假阴性 |
| `"job queue cron"` | **23** |

日志里那一整句是真实存在的，只是 CLS 的全文检索对长短语匹配不到。
**判定「没有这类错误」时，务必用 3–4 个词的短片段，别贴完整句子。**
我这次是因为手上已经有已知阳性做对照才发现的——否则会直接得出
「切流量期间零错误」这个正好相反的结论。

## 6.6 生产验收：切流量下的真实争抢（2026-08-25，`sbh-110` → `sbh-111`）

§6.5 当时的结论是「已具备可观测性，但因果证明只有本地复现」——**这一节把它补上了。**

### 这次不是特意造的，是 OPT-047 部署顺带撞上的

OPT-047 上线走的正是 §6 要求的那个条件：**版本切换、新旧实例并存、jobs 开着**
（`PAYLOAD_DISABLE_JOB_AUTORUN="0"`）。不用再单独安排一次。

### 争抢确实发生了 —— 23 次

| 时段 | 实例 | `Error in job queue cron job handler` |
|---|---|---|
| 14:36:01 – 14:54:31 | `sbh-110` + `sbh-111` 并存 | **23 次**（30s 的 cron tick 几乎每次都撞） |
| 14:54:31 之后 | 仅 `sbh-111` | **0 次** |

伴随堆栈是 `TypeError: Cannot use 'in' operator to search for '_rels' in undefined`
——与 §5.1 本地复现的链条完全一致。

**这正是 §6 要的信号**：「没有它反而说明没测到」。而且两实例期间几乎每个 tick 都撞、
单实例后立刻归零，等于一次对照实验，直接坐实 §5.3「稳态不漏、实例重叠才漏」。

### 但一次都没漏

| 检查 | 结果 |
|---|---|
| `pg_stat_activity` 中 `idle in transaction` | **0**（只有 10 个 `idle` + 1 个 `active`） |
| `sbh-111` 自己的连接池（`usename='sbh'`） | **2 条，全部 `idle`**，最早一条建于 14:33:56 |

**为什么这是因果证明，而不只是又一次「没看到问题」**——三个混淆项都排掉了：

1. **不是被超时清掉的。** `idle_in_transaction_session_timeout = 0`（`source=default`），
   `pg_db_role_setting` 里该项**只设在 `cloudbase_auth_admin` 上**，应用用的 `sbh`
   角色没有任何超时。泄漏的事务会一直挂着，不会自己消失。
2. **不是随实例销毁一起没的。** `sbh-110` 已退场，它的连接确实会随 pod 终止而关闭——
   但 `sbh-111` **至今还活着**，而它自己在 14:36–14:49 之间撞了 7 次。
   若 patch 无效，这 7 次的泄漏此刻应当还挂在它的池子里。实测：0。
3. **patch 确实在这两个镜像里。** `f0cdb02`（patch 提交）是 `sbh-110` 基线 `724322f`
   的祖先，`sbh-111` 更新。两个实例都带。

对照 §5.3 修复前的实测「切流量 8 分钟漏 9 个」：这次 **18 分钟、23 次争抢、漏 0 个**。

### 顺带修掉的观测盲区：`silent: true` 吞掉了任务错误

验收时才发现三个 cron 都写着 `silent: true`，而 Payload 3.86 的
`RunJobsSilent = { error?: boolean; info?: boolean } | boolean`——`true` 会把**两类
一起压掉**：

| 类别 | 出处 | 内容 | 判断 |
|---|---|---|---|
| `info` | `operations/runJobs/index.js:229` | 每轮「跑了几个 job」的汇总 | **该压**：30s/10s 一轮常驻空转，纯噪音 |
| `error` | `errors/handleTaskError.js:67,96`、`handleWorkflowError.js:45` | 任务/工作流抛的错 | **不该压**：通知没发出去、导入炸了，全是静默失败 |

改成 `{ info: true, error: false }`，两者分开——**不是 §6 顺手写的 `silent: false`**，
那会把 30 秒一次的空转汇总全放出来，反而把真错误埋回去。

> **这个盲区之所以能藏这么久，是因为「job 出错时日志里确实有东西」。**
> `Error in job queue cron job handler` 来自 Croner 包装层的 catch
>（`payload/dist/index.js:267`），**无条件打印，不受 `silent` 影响**——
> OPT-046 这个争抢错误走的正是这条。
> 于是现场证据看起来是「silent 没吞任何东西」，而被吞的是另一类、
> 且恰恰是业务上更要紧的那类。**局部证据支持了一个过宽的结论。**

**守卫**：`tests/job-cron-error-logging.test.ts` 2 条，**双向验证**——
改回 `silent: true` 红在「吞错误」，改成 `silent: false` 红在「噪音」，
只有分开控制才绿。

### §6 验收项对账

| §6 要求 | 结果 |
|---|---|
| 打开 jobs + 走一次切流量，≥ 30 分钟 | ✅ 14:26 切换，观测至 15:10（44 分钟） |
| `idle in transaction` 不增长 | ✅ 全程 0，且已排除超时/销毁两个混淆项 |
| `/api/health` 与 `/shanghai/listings` 全程 200 且无劣化 | ✅ `status=ok`/`db=ok`；列表页 0.10s（见 OPT-047 §6.6） |
| 关掉 `silent: true` 后不再有被吞的 job 错误 | ✅ 改为 `{ info: true, error: false }` + 守卫 |

**本工作项至此验收完毕。**


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

## 7.5 顺带发现：迁移快照链已回退 → **已立项 OPT-048 并修复**

> **2026-08-24 订正**：本节下面「`20260822_001600` / `001700` 根本没有配套 `.json` 快照」
> 一句是**误判**。手写的数据/索引迁移不经 `migrate:create`，Payload 本来就不会为它们
> 生成快照，属正常。真正的问题只有 config↔快照的那一处分叉（`avg_response_hours`）。
> 完整体检、与生产 schema 的比对、修复方式见 **OPT-048**。

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
