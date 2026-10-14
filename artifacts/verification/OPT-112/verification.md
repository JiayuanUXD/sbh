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
| `pnpm build` | 通过（`b04d13b`） |
| 表结构 | 本地库迁到最新后 `migrate:create --skip-empty` 未生成文件；`payload.config.ts` 的改动经用户确认以 `SKIP_MIGRATION_CHECK=1` 提交 |
| `importMap.js` | `generate:importmap` 后无变化 |

## 6. 没验到的

- 生产后台需要登录态，上线后由用户点一次按钮；次日复看进度与日志。
- 同一个 job 被两个实例同时捡起（切流退场窗口的旧实例）不在本工作项，见工作项「旁支」。
- 生产库里此前多次点击留下的在途段：上线后由新代码接着跑，按 id 串行、彼此不并发；它们推进的是同一批「不是当前版本」的图，最多多扫几页，不会重复烘焙。
