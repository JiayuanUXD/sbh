# OPT-114 验证记录

> 工作项：`specs/work-items/OPT-114-listing-large-page-bulk-unpublish.md`
> 分支：`feat/opt-114-listing-bulk-unpublish-417b`（实现提交 `94a6e1f5`）
> 日期：2026-10-15，本机 macOS，Node v24.14.0（项目要求 22.x，各命令只报 engine 警告）

## 1. 静态与单测

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error；35 条 warning 全部在既有文件，本次改动的 7 个文件单独跑 eslint 无输出 |
| `pnpm test` | 455 个文件 / 6237 条全过 |
| `CI=1 pnpm build` | 通过（主树一次、干净 worktree 一次） |
| 新增单测 | `tests/batch-request.test.ts` +16（切片 / 串行 / 失败即停 / 进度 / 空输入）；`tests/listings-list-page-size.test.ts` 13（白名单 + select 覆盖行映射的读源码契约） |

TDD：两组新单测都先跑红（函数 / 模块不存在），再实现到绿。select 契约测试另做了一次变异：从 select 删掉 `roomNumber` → 红，并报出缺的字段；还原后绿。

## 2. 夹具

`seed-500-listings.mts`：建「OPT-114 批量下架压测楼盘」（本地楼盘 #13）+ 500 套已上架 / 审核通过房源（无图、无商户）。
入口过 `assertSeedTargetFromProcessEnv`（`DATABASE_URL` 必须是环回地址）。`--reset` 把夹具房源全部恢复上架，每轮验收前用；`--trash` 把夹具楼盘与房源移进回收站。

**跑 E2E 前必须 `--trash`。** 起初以为夹具不影响 E2E（`list-batch-actions` 选房源要求已设商户），实测错了：第一轮 E2E 3 条红，全部是夹具造成的——
夹具更新时间最新，占满 `?limit=100` 的第一页（两套目标房源排第 528、529 位）；`listing-publication-actions` 取「任一已上架房源」时取到夹具，下架后恢复上架因 `NO_SUPPLY_MERCHANT` 失败。见 §6。
验收结束后夹具留在本地库的**回收站**里（软删，`deleted_at` 非空），默认模式或 `--reset` 可恢复。

## 3. 列表查询瘦身（D5）

`measure-list-query.mts` → `list-query-500.json`。条件与列表页一致（复用 `buildListingListConditions`），每个变体预热 1 次 + 5 轮取中位：

| 变体（500 条） | 中位耗时 | 返回体积 |
|---|---|---|
| 现状：depth 1 全量展开 | 70–72 ms | 1,371,219 B |
| 瘦身：select + populate | 28 ms | 212,119 B |

夹具房源**没有图片**；生产房源带封面与图集，全量展开的成本更高，这里的差距是下限。

## 4. 浏览器验收（dev server，本地库）

登录 `e2e-adm@example.com`（`scripts/seed.ts` 公开夹具）。路由：`/admin/collections/listings?building=13&publicationStatus=published&limit=500`。

### 4.1 主流程：500 套保留 10 套

1. 每页 500：表格 500 行 / 500 个勾选框，分页显示「共 500 条」「500 条/页」；各列（标题 + 楼盘名、类型、审核、发布、面积、房间号、更新时间、操作）正常。
2. 表头全选 →「已选 500 项」；逐个取消前 10 行 →「已选 490 项」。
3. 批量下架 → 确认框「将下架 490 条房源」（`light-01-confirm-490.jpg`）。
4. 填原因、确认 → 进度「正在分批执行：已处理 0 / 490 条」（`light-02-progress-0.jpg`）→ 100 → 200（`light-03-progress-200.png`）…；提交中取消键禁用。
5. 网络：5 次 `POST /api/listings/batch-publish`，条目数 100 / 100 / 100 / 100 / 90，全部 200；末批响应 `succeeded: 90, failed: 0`。服务端单次 5.3–7.1 s（dev），合计约 32 s。
6. 完成后弹层自动关闭，列表刷新为「共 10 条」，勾选清空（`light-04-after-refresh-10-left.jpg`）。

库内核对：

```
published   | 10    -- 房间号 2711–2720，正是未勾选的 10 套
unpublished | 490
audit_logs: listing.unpublish | OPT-114 验收：只保留 10 套在租 | 490
```

### 4.2 失败即停（D3）

页面内注入 fetch 拦截：第 2 次 `batch-publish` 直接返回 `500 {"error":"模拟：服务端错误"}`（不到服务端）。勾选 500 条 → 批量下架：

- 只发出 2 次请求（各 100 条、`action: unpublish`、带 `reason`），第 3 批起未发送；
- 结果段：「成功 100 条。另有 400 条未执行或结果未知：模拟：服务端错误 / 关闭后列表会刷新，请以列表中的状态为准。」（`light-05-stopped-after-chunk-2.jpg`）；
- 点「知道了」→ 列表刷新为「共 400 条」，勾选清空。

注：拦截器自身没处理 `URL` 对象入参，导致随后 `router.refresh()` 的 RSC 请求抛 `reading 'includes'`，Next 回退为整页导航（刷新照样完成）。堆栈指向注入代码 `window.fetch (<anonymous>)`，不是产品代码；不注入拦截器的主流程一轮里，控制台只有既有的首页 hero 视频 403。

### 4.3 深色模式

确认态（`dark-01-confirm-400.jpg`）、进度态（`dark-02-progress-0.png`）、部分未完成结果（`dark-03-stopped-after-chunk-2.jpg`）均为深色底、无白底残留。
已知问题（既有，OPT-113 §5 已记）：深色下 `custom.scss` 把 `.arco-typography` 统一成正文色，「另有 N 条…」不是红色，信息仍可读。本项未修。

## 5. 生产模式复测（干净 worktree）

dev 模式的数字不作结论（逐路由 JIT、React 开发期检查）。在不含 `.env.production*` 的 detached worktree（`~/wt-opt114`，提交 `94a6e1f5`，量完已删除）里
`pnpm install --frozen-lockfile` → `generate:types` → `CI=1 pnpm build` → `CI=1 PAYLOAD_DISABLE_JOB_AUTORUN=1 pnpm start -p 3799`，
启动命令带「存在 `.env.production*` 即拒绝启动」守卫；启动后核对进程 cwd 为该 worktree，且本地夹具 cookie 可直接登录（生产无此账号，佐证连的是本地库）。

### 5.1 页面加载（热，`?building=13&publicationStatus=published`）

| 每页 | TTFB | load | HTML（解码后） |
|---|---|---|---|
| 500 | 258 / 283 / 329 ms | 379 / 394 / 451 ms | 3,349 KB |
| 100 | 131 / 131 ms | 166 / 169 ms | 959 KB |
| 25 | 107 ms | 136 ms | 512 KB |

对照：同一页面在 dev 下每页 500 条 TTFB 约 4.7 s、每页 100 条约 1.3 s——dev 渲染开销，生产不存在。

### 5.2 勾选交互

Event Timing 的 `duration` 在本次环境里**不可用**：浏览器面板处于隐藏状态，不合成帧，`duration`（到下一帧呈现）恒为 1–2 s，dev 与生产读数几乎逐位相同（1136 / 2032 …），量到的是等帧而不是渲染。
改读 `processingEnd - processingStart`（事件处理 + React 同步提交）：

| 操作（500 行一页） | 处理耗时 | 输入延迟 |
|---|---|---|
| 单行取消 / 重新勾选（4 次点击） | 44–55 ms | 2–20 ms |
| 表头全选（1 次点击） | 43–44 ms | 1–2 ms |

（每次点击记两条 click 事件：Arco 复选框的 label 点击会再派发一次 input 的 click，两条读数相同，按一次计。）

不含样式计算 / 布局 / 绘制（面板隐藏时测不到）。处理耗时在几十毫秒，**不需要**表格虚拟滚动（工作项 §5 的「> 1s 再议」条件不成立；dev 下的 1–2 s 读数同样是等帧假象）。

### 5.3 批量下架 490 条

全选 → 取消 10 → 批量下架 → 确认：从点「确认下架」到弹层关闭 **25.3 s**（约 5 s / 100 条一批），列表刷新为「共 10 条」、勾选清空。
瓶颈在服务端逐条执行（状态机 + 审计 + 缓存失效），与 dev / 生产模式无关（dev 下约 32 s）。
本地库往返近乎 0；生产库在云上，单条更慢，但单次请求仍是 ≤100 条，与 OPT-113 已上线的上限一致。

## 6. E2E（dev server，复用主树 3717，本地库）

`pnpm exec playwright test tests/e2e/{list-batch-actions,listing-room-number,listing-publication-actions,admin-navigation}.spec.ts --workers=1`

| 轮次 | 夹具状态 | 结果 | 日志 |
|---|---|---|---|
| 1 | 500 套已上架、未移入回收站 | 27 过 / 3 红 | `e2e-run1-fixture-active.log` |
| 2 | `--trash` 移入回收站 | **30 过 / 0 红** | `e2e-run2-fixture-trashed.log` |

第 1 轮的 3 条红：

- `list-batch-actions.spec.ts:177`（批量下架 → 批量上架）：`rowOf(listings, 1)` 期望 1 行、实际 0。库内核对：目标房源 #1、#2 在「更新时间倒序」里排第 529、528 位，`?limit=100` 第一页 100 行全是夹具楼盘 #13。
- `listing-publication-actions.spec.ts:202` / `:246`：`pickPublishedListing` 取到夹具房源 #530 / #529，下架成功后恢复上架 422 `NO_SUPPLY_MERCHANT`（夹具无商户）。

根因是本地数据，不是代码：夹具移入回收站、代码不动，第 2 轮全绿。第 1 轮被这两条 spec 下架的夹具 #529 / #530 已由 `--reset` 复位。

顺带更正了 `listing-publication-actions.spec.ts` 一处过时注释（原写「limit=100 是列表允许的最大档，取值 10/25/50/100」）。

## 7. 事故记录：生产模式复测时误连生产库约 1 分钟

- **经过**：第一次复测在主工作树起 `CI=1 pnpm start -p 3799`。主树 `payload-office-platform/.env.production.local` 是全套生产凭据（生产 TencentDB / COS / `PAYLOAD_SECRET`，无 `PAYLOAD_DISABLE_JOB_AUTORUN`），`next start` 读它且优先于 `.env.local`。约 16:38:50–16:40（+08）在线：渲染了一次首页（只读）、一次 `e2e-adm@example.com` 登录 401。发现后立即停掉。
- **核查**（用户授权，只读连接 `default_transaction_read_only=on`，时间窗 16:37–16:42 +08）：
  - `payload_jobs`：窗口内与前后对照窗口新建 / 改动均为 0；全表最后更新 2026-10-14 09:47。
  - `users`：生产无 `e2e-adm@example.com`、无任何 `@example.com` 账号；窗口内无用户行改动。
  - `audit_logs`：窗口内 0 行。16:45 / 16:48 的 `building.update`（路径 `https://localhost:80/api/buildings/batch-publish`）来自 CloudRun 线上实例的真实操作，与本地无关。
  - 全库 52 张带 `created_at` / `updated_at` 的表：窗口内命中均为 0。
  - **结论：对生产库无写入。**
- **改正**：生产模式复测改在不含 `.env.production*` 的干净 worktree 里做（见 §5），启动命令带「存在 `.env.production*` 即拒绝启动」守卫与 `PAYLOAD_DISABLE_JOB_AUTORUN=1`。
- **后续建议**：`.agent/testing.md`「本地 next start 跑 CI 等价 E2E」一节应补上这个文件的风险（另议）。

## 8. 脚本

| 文件 | 用途 |
|---|---|
| `seed-500-listings.mts` | 建 / 复位夹具（用法见文件头） |
| `measure-list-query.mts` | 列表查询两种写法的耗时与体积对照 |
| `list-query-500.json` | 上表的原始输出 |
| `e2e-run1-fixture-active.log` / `e2e-run2-fixture-trashed.log` | §6 两轮 E2E 的原始输出 |
