# OPT-112 水印重刷链路可靠性：验证记录（2026-10-14）

环境：本地 PostgreSQL 16（迁移到最新）、本地磁盘存储（不配 COS）、`next build` + `next start`（生产模式，端口 3790）。
账号是 `scripts/seed.ts` 的公开 E2E 夹具。

## 1. 根因复现：上传事务里读设置另借连接（T1）

`pool-probe.mts`，`DB_POOL_MAX=2`（适配器启动时常驻借走 1 条，只剩 1 条），开水印上传一张实景图：

| 代码 | 结果 |
| --- | --- |
| 对照：`origin/master`（`f0c550f`）的 `watermark-settings.ts` + `plugins/watermark.ts` | **10.2 s 后失败**，查询 `site_settings`，cause `timeout exceeded when trying to connect`——与生产日志同一指纹 |
| 本分支 | 0.5 s 成功，写上 `watermark.version` |
| 本分支，默认池（20） | 0.6 s 成功 |

原始输出：`pool-probe.txt`。对照组确为未修复状态：跑之前把这两个文件换成 master 版本，`grep` 确认 hook 调用不带 `req`，跑完 `git checkout HEAD --` 还原。

## 2. 浏览器走查：进度、点击、重复点击（T6–T7）

`browser-walk.mjs start`（45 张无 version 的实景图 + 2 张已烘的探针图）：

| 步骤 | 结果 |
| --- | --- |
| 打开「站点设置 → 图片水印」 | 「已完成 2 / 47 张」「还有 45 张不是当前参数…」，按钮可点（`walk-start-loaded.png`） |
| 点按钮 | `POST` 200 `{ queued: true }`；按钮变「重刷进行中」并禁用（`walk-start-after-click.png`） |
| 同一会话再 POST 一次 | 200 `{ queued: false, reason: "running" }`，没有排第二条链 |
| 链条跑完后再打开 | 「已完成 47 / 47 张」「全部已是当前参数…」，按钮可点（`walk-view-loaded.png`） |

注：`walk-start-*.png` 两张截图已被 §6 两实例那一轮同名覆盖（画面是「52 / 112」与评审后新增的「已加入队列。」），
本节的文字数据以 `walk-start.json` 为准，§6 那一轮的数据见 `walk-two-instances-start.json`。

控制台两条 `ERR_TUNNEL_CONNECTION_FAILED` 是 Payload 默认头像 `www.gravatar.com`（云端会话代理拒绝外网），另有导航时被中断的 `admin-navigation` / `dashboard-stats`（`ERR_ABORTED`），均与本改动无关（`walk-view.json` 的 `failedRequests`）。

## 3. 模拟发版杀段 → 自动回收 → 链条跑完（T2–T4）

1. 点按钮后，watcher 在第一段（job 18）已烘 3 张时 `kill -9` 服务进程——job 18 停在 `processing = true`，即生产发版缩容后的现场。
2. 把 job 18 的 `updated_at` 回拨 16 分钟（模拟租约过期），重启服务。
3. 时间线（`chain-timeline.txt`）：

```
09:48:24 versions=5  jobs=[18:-:proc]     ← 新进程 cron 启动
09:48:35 versions=5  jobs=[18:-:pend]     ← shouldAutoRun 回收，放回队列
09:49:01 versions=6  jobs=[18:-:proc]     ← 下一个整分钟被捡起，从断点之后继续
09:49:11 versions=25 jobs=[23:43:pend]    ← 本段 20 张完成，续投下一段（游标 43）
09:50:14 versions=45 jobs=[26:63:pend]
09:51:06 versions=47 jobs=[]              ← 全部完成（完成的 job 由 Payload 删除）
```

回拨前的同一进程只请求过 `/api/health`，11 分钟里 job 18 一直 `proc`、回收没跑——这是下面第 4 节那个发现。

**被打断的那段没有叠两层水印**（`single-layer-check.txt`）：拿 `media-source/` 的干净备份按当前配置烘一次，与 `media/` 里的母版逐字节相同；在母版上再烘一层则不同（判据有区分力）。覆盖被打断后续跑的第 4 张，以及第 1 / 20 / 45 张。

## 4. 验收中发现并修复：自定义路由不启动任务 cron

Payload 只在 `getPayload({ cron: true })` 时启动任务 cron；后台页面（`initReq`）与 REST（`createPayloadRequest`）会带，自定义路由默认不带。重刷路由改为以 `cron: true` 取实例（与 `supply-submissions` 同一做法）。重建后实测（`cron-start.txt`）：

```
09:55:48 新进程只请求过 /api/health；预先用脚本排好段 33
09:57:03 段 33 仍是 pend（09:57:00 的 cron 点没人跑）
09:57:03 未登录 GET /api/watermark-rebake → 401（鉴权前已以 cron: true 取实例）
09:58:05 段 33 跑完，52/52
```

生产上后台任意操作都会经 REST 启动所在实例的 cron，这一条是「新实例只收到本路由请求」时的兜底。

## 5. 闸门

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error，35 条既有 warning（与改动前同数） |
| `pnpm test`（无 `DATABASE_URL`，postgres 套件按设计不收集） | 447 文件 / 6066 条全绿 |
| `pnpm migrate:dry-run` | 通过（4 条既有 warning，本分支未加迁移） |
| `pnpm build` | 通过（`b04d13b`；评审修复后 `bb4d384` 再次通过） |
| 表结构 | 本地库迁到最新后 `migrate:create --skip-empty` 未生成文件；`payload.config.ts` 的改动经用户确认以 `SKIP_MIGRATION_CHECK=1` 提交 |
| `importMap.js` | `generate:importmap` 后无变化 |

## 6. 独立评审之后：段互斥改为 advisory lock，两实例实测

评审指出初版 T5（「有没有 id 更小的段在跑」计数）挡不住三种并发，其中最要紧的是：Payload 3.86 的
drizzle `updateJobs` 认领 job 是「先查待跑的、再按 id 逐条更新」，不复核 `processing = false`，**同一个 job
会被两个实例同时捡起**。初版的注释与本文件旧版 §6「按 id 串行、彼此不并发」据此不成立，已改。

改为事务级 advisory lock（`runWithSegmentLock`）：先拿 `(命名空间, job id)`——拿不到或这一行已完成 = 同一 job
的另一份副本，什么都不做也不续投；再拿全局段锁——拿不到就推迟 45 秒重投自己。真库测试
`tests/media-watermark-rebake-lock-postgres.test.ts` 钉住 duplicate / busy / 已完成 / 抛错释放 / 租约到期由 PG 释放锁。

**两实例实测**（`two-instances-timeline.txt`、`two-instances-logs.txt`）：两个 `next start` 进程（3790 / 3791）共用一个库，
60 张新的未烘图；后台按钮排链 C1，脚本另排一条链 C2（模拟此前多次点击留下的链）。

| 观察 | 结果 |
| --- | --- |
| 每秒采样「持有全局段锁的会话数」 | 最多 1 |
| 未结束的段数 | 最多 2（= 链数，没有翻倍） |
| 让路 | 10:30 job 46、10:31 job 50 各推迟 45 秒后跑上 |
| 同一 job 被两个进程同时捡起 | **3 分钟内发生 2 次**（job 54、55），各有一份副本记「已由另一份副本处理，本副本不做事」 |
| 结果 | 3 分钟 60 张全部完成（112/112）；60 张逐张检查均为「干净备份 + 一层水印」（`single-layer-two-instances.txt`） |
| 页面 | 点击后显示「已加入队列。」，再 POST 回 `running`（`walk-two-instances-start.json`） |

**旁证**：同一段日志里，无关的 `reconcile-city-partner-notification-outbox` 任务也出现
`insert into "payload_jobs_log"` 失败与 `TypeError: Cannot use 'in' operator to search for '_rels' in undefined`——
与生产日志同一指纹。可见「同一 job 被重复执行」**只要有两个以上实例就会发生**，不只在切流退场窗口；
水印重刷已由段锁兜住，其他任务类型留给工作项「旁支」。rebake job 54 也有一条同样的记账报错：两份副本里先结束的
那份把 job 标完成并删除，另一份收尾记账时找不到行——段内的活已经做完、续投已在锁内完成，不影响结果。

### 6.1 Codex 两条 P1 修复后：第二轮两实例实测

PR #218 上 Codex 提了两条 P1，均成立：

1. 副本立刻正常返回 → Payload 把**共享的** job 标完成并删除；持锁者随后若被杀，陈旧回收找不到行，链条永久断掉。
   → 副本改为**待命**：每 5 秒试一次 job 锁，持锁者跑完（行已完成）才以 duplicate 退出，持锁者死了则接手。
   持锁者在锁内把行标完成再提交，完成标记与释放锁一起生效。
2. 段跑得比租约长时「事务内空闲上限」会结束持锁会话，活没干完锁就丢了。
   → 干活期间每分钟在持锁连接上**心跳**；陈旧回收跳过 job 锁仍被持有的段。

真库测试新增：待命到持锁者跑完、持锁者被 `pg_terminate_backend` 后副本接手、心跳让锁越过租约、心跳停了锁被放掉、
回收跳过持锁段（共 8 条，全过）。

第二轮实测（`two-instances-timeline-r2.txt`、`two-instances-logs-r2.txt`、`single-layer-two-instances-r2.txt`，60 张新图）：

| 观察 | 结果 |
| --- | --- |
| 全局段锁持有者 / 未结束的段 | 最多 1 / 最多 2（= 链数） |
| 让路 | 10:56 job 102 推迟 45 秒后跑上 |
| 重复认领 | job 106、107 各被两个进程捡起；副本**等到持锁者跑完**（10:57:11 / 10:58:08 前后）才在下一次试锁时（10:57:15 / 10:58:10）以 duplicate 退出——不再在持锁者干活时删掉共享的行 |
| 结果 | 3 分钟 60 张全部完成（172/172），逐张均为一层水印 |

副本退出后 Payload 记账时那一行已被持锁者删除，仍会记一条 `_rels` TypeError——与旁支同一根因，无害。

## 7. 没验到的

- 生产后台需要登录态，上线后由用户点一次按钮；次日复看进度与日志。
- 其他任务类型的重复执行不在本工作项，见工作项「旁支」。
- COS 请求没有超时（`media-writer.ts` 的 S3 客户端未设）：某段若卡在一次永不返回的 COS 请求上，心跳照常、锁一直在，
  整个重刷会停住，直到该进程重启（重启后锁随会话释放、段被回收）。刻意选择「停住」而不是放别的段进来与它并行。
