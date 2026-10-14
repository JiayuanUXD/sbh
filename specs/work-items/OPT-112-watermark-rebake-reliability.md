# Task Packet：OPT-112 水印重刷链路可靠性

> 状态：**实施中**（方案 A 于 2026-10-14 获用户确认：「走 A，开工」）
> 创建日期：2026-10-14
> 来源：用户报告「后台多次点『重刷全部房源图』均未成功」，2026-10-14 查生产日志定位根因
>
> **For agentic workers:** 按 Task 顺序执行，每个 Task 自带测试闭环；步骤用 `- [ ]` 勾选。

**目标：** 运营在「站点设置 → 图片水印」点一次「重刷全部房源图」，链条能自己跑完全表；页面上看得到「已完成 / 总数」和是否在跑；重复点不会再开第二条链。

**技术栈：** Payload 3.86 Jobs Queue（autoRun cron）、upload afterChange hook、Vitest。

---

## 1. 现状与证据（2026-10-14，master `f0c550f`，生产日志）

| # | 事实 | 证据 |
|---|---|---|
| E1 | 单张失败**全部**是连接池拿不到连接：`select "site_settings" …` → `timeout exceeded when trying to connect`，一天约 60 条 | 生产日志（CloudRun `sbh`，`[watermark] media … 重刷失败`） |
| E2 | 失败的那条查询来自上传事务**内部**：`payload.update` 开事务并占住一条连接 → afterChange 里 `resolveWatermarkRenderContext(req.payload, writer)` 调 `findGlobal` **不带 `req`** → 另借一条连接。池子紧张时，事务拿着连接等第二条，自己卡自己 | `src/plugins/watermark.ts:346`、`src/domain/media/watermark-settings.ts:readWatermarkSiteSettings` |
| E3 | 续投下一段失败即断链：`payload.jobs.queue` 没有重试，任务级 `retries: { attempts: 2 }` 无退避，池风暴里两次失败就 `hasError` | `src/domain/media/watermark-rebake.ts`（handler 尾部） |
| E4 | 发版会杀掉正在跑的段：旧实例缩容时 job 停在 `processing = true`，`shouldAutoRun` 里没有水印任务的陈旧租约回收，这一段永远不会再被捡起，链条就此中断 | `src/payload.config.ts` `shouldAutoRun`（只回收城市合伙人 / 导入 / 同步三类） |
| E5 | 链条断了运营只能再点，而再点**从 id 0 重新扫**：每段扫 100 行、每分钟一段，已完成的图也要一页页扫过去；一天下来只推进到 id 2000–2153 附近 | 生产日志 `startAfterId`；handler 的 `find` 只按 `id > startAfterId` 取 |
| E6 | 重复点击会并行多条链，各链间没有串行约束；两条链同时处理同一张「无 version、无备份」的图时，存在把已烘字节写进 `media-source/` 的竞态窗口（极窄，但后果是干净原件丢失） | `rebakeChunk` 的 `backup-and-bake` 分支（读备份与读当前文件之间无锁） |
| E7 | 页面上看不到进度：按钮只回「已加入队列」，之后跑没跑、跑到哪、断没断全无反馈 | `src/components/admin/WatermarkRebakeButton.tsx` |

排除项：HTTP 端点失败（无 5xx）、开关关闭（无对应 warn）、autoRun 未启用（日志可见 cron 在跑）。

**旁支（不在本工作项）：** 切流后旧版本实例在退场窗口内仍跑 cron，同一个 job 被两个实例同时执行，引发 `payload_jobs_log` 插入失败与 `updateJobs` 的 `Cannot use 'in' operator to search for '_rels' in undefined`，影响**所有**任务类型，单独立项。

## 2. 方案

| # | 改动 | 对应 |
|---|---|---|
| T1 | `readWatermarkSiteSettings` / `resolveWatermarkConfig` / `resolveWatermarkRenderContext` 接受可选 `req`，透传给 `findGlobal`；上传 hook 传自己的 `req`，复用事务连接 | E1 E2 |
| T2 | 任务按「`usage = listing-photo` 且 `watermark.version ≠ 当前哈希`（含 null）」在库里过滤，不再逐页扫已完成的图；重新开链的代价因此只剩真正没做完的图 | E5 |
| T3 | 续投带退避重试（3 次）；仍失败就抛错交给任务级重试（改为 5 次、指数退避 30s 起），重跑是幂等的（T2 让已完成的图直接被过滤掉） | E3 |
| T4 | `shouldAutoRun` 增加水印任务的陈旧租约回收（15 分钟，与同步 / 导入同口径） | E4 |
| T5 | 同一时刻只跑一段：handler 开头若有 id 更小、仍在租约内的同类段在跑，就推迟 60 秒重投自己（不丢段、按 id 决胜，避免互相让） | E6 |
| T6 | 路由 `POST` 发现已有未结束的链（待跑，或在租约内处理中）就不再排队，回 `{ queued: false, reason: 'running' }`；新增 `GET` 回 `{ enabled, total, done, running }` | E5 E7 |
| T7 | 按钮挂载即取进度，显示「已完成 X / 总数 Y」；在跑时禁用按钮、每 15 秒刷新；结束后若 `done < total` 提示剩余张数（缺备份等失败见服务日志） | E7 |

不做：任务吞吐调优（每分钟一段、每段 20 张维持不变）；旧实例重复执行（见旁支）。

## 3. 验收

- [ ] T1：单测证明 hook 读设置时带 `req`；本地 `DB_POOL_MAX=2`（适配器常驻借走 1 条，只剩 1 条）复现「上传带水印图 → 连接超时」，修复后同条件通过
- [ ] T2–T5：单测覆盖过滤条件、续投重试、陈旧回收 SQL、串行判定
- [ ] T6–T7：本地浏览器走一遍：进度显示、点击后转「进行中」、重复点被拒、跑完数字到齐
- [ ] 全量闸门：typecheck / lint / test / migrate:dry-run / build
- [ ] 合并上线后：用户点一次按钮；次日看进度与日志

## 4. 证据

`artifacts/verification/OPT-112/`
