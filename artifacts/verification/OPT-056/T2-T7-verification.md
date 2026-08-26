# OPT-056 T2–T7 验证证据

日期：2026-08-26 · 分支 `feat/admin-ux-batch-6a11` · 本地 dev(3717) 浏览器实测（e2e-adm 账号）

## T2 开发者备注净化

- A 级（OPT-0xx / § 章节 / FP-05 / design §x）8 处 + B 级「乐观锁」14 处 + C 级术语
  约 40 处全部改写/删除；`rg` 复扫 description 字符串零残留（代码注释按约定保留）。
- 两处 label「幂等键」→「防重标识」（Leads.idempotencyKey / SupplySubmissions.idempotencyKey）。
- `payload-types.ts` 随 description 同步重生成，`grep -c prefix` = 2 ✓。

## T3 默认值

创建页 `/admin/collections/listings/create` 表单初始状态（React fiber 实测）：

```
{"verifiedAt":"2026-08-26T12:41:58.330Z","merchant":3}
```

- `merchant` 预填 id=3（「官网」，`resolveDefaultSupplyMerchant` 既有链路，无需改动）。
- `verificationInfo.verifiedAt` 新增 `defaultValue: () => new Date().toISOString()`
  （Listings + Buildings 各一处，运行时函数，不动表结构）。

## T4+T7 房源/楼盘列表 Arco 化

`/admin/collections/listings`（1200×800 视口）：

- 35 条数据分页「共 35 条 / 25 条/页 / 2 页」；列：标题(+楼盘副行)、类型 Tag、
  审核状态 Tag、发布状态 Tag(+待复核红标)、面积、首页推荐 Switch、更新时间、操作。
- 无「所有 房源列表」抬头；右上角「创建房源」主按钮 + 「回收站」入口 ✓。
- 搜索+筛选组合：`?publicationStatus=published&q=虹桥` → 4 条正确命中 ✓。
- 快捷编辑三步铁证（listing id=7）：
  1. 抓包：`PATCH /api/listings/7` 请求体 `{isFeatured:true, version:19}`；
  2. 响应：200，响应文档 `isFeatured:true, version:20`（乐观锁递增）；
  3. 强刷重读：`GET /api/listings/7` → `isFeatured:true, version:20` ✓（随后已回滚为 false）。
- 深链参数（老链接迁移）：
  - `?building=6&missingCover=1` → 「楼盘：虹桥国际商务中心」「仅看缺少封面」
    两个可关闭标签 + 空态正确 ✓（BuildingAggregateCard 的「查看房源」已改为该格式）。
  - `?pendingRecheck=1` → 4 条待复核房源，与概览计数一致 ✓。

`/admin/collections/buildings`：7 条楼盘，城市/行政区（depth1 关系名）、等级/类型 Tag、
发布/启停状态 Tag、城市/状态/等级筛选、右上「创建楼盘」✓。

## T5 每页 25 条

- 31 个 collection 统一 `admin.pagination: { defaultLimit: 25, limits: [10,25,50,100] }`。
- 原生列表实测（leads，67 条）：曾存 `collection-leads` 偏好 `{limit:10}` 时仍显示 10
  （**用户主动选择优先，Payload 设计语义**）；删除偏好后 → **25 行 / 每一页: 25** ✓。
  生产上已手动选过每页条数的账号会保留其选择，新账号/未选过的默认 25。
- 三个存量自定义视图（Geography / AuditLog / ReviewQueue）20 → 25。

## T6 运营概览

- 慢点收敛：有效供给候选查询 `depth 2 → 1` + `select: {building, merchant}` 投影
  （精筛快照只需 building.city / merchant 裸 id，toId 归一）；端点新增按用户 60s TTL
  缓存（闭包内 Map，多用户隔离，200 条上限清空）。
- 实测：`/api/dashboard-stats` 首查 31ms、缓存命中 13ms（本地小数据集；改动前
  同环境日志为 322–354ms application-code）。
- 内容充实：新增「审核与风控待办」卡（待审核房源 / 待复核供给 / 未关闭举报 /
  待处理投放申请），计数与深链一致（待复核 4 ↔ 列表 4 条）；无权限项服务端降级
  null、前端隐藏（tests/dashboard-stats.test.ts 有对应用例）。

## 质量门（quality.yml 同序）

- `pnpm generate:types` + `generate:importmap` ✓（importMap 已含两个新视图）
- `pnpm typecheck` ✓ 0 错
- `pnpm lint` ✓ 0 error / 23 处历史 warning
- `pnpm test` ✓ 全量通过（含 3 个 dashboard 契约测试更新 + 1 个新降级用例 + 缓存用例）
- `pnpm migrate:dry-run` ✓ 0 阻断（4 警告均为历史迁移既有）
- `pnpm exec payload migrate:create` → **"No schema changes detected"**
  （SKIP_MIGRATION_CHECK=1 提交的依据：本批全部为 UI/admin 配置层改动）
- `pnpm build` ✓

## 环境侧发现（非缺陷，已排除）

排查 T3 时发现本会话的隐藏浏览器面板不合成帧：Payload 3.86 表单字段的
`RenderIfInViewport`（IntersectionObserver 懒渲染）不触发，导致编辑页所有 group
字段「看起来没渲染」；真实浏览器无此问题（生产无碍）。同因还发现
`AdminNavigationClient` 的 mounted 初始化 rAF 在后台标签页永不执行——已顺手改为
`setTimeout(0)`（见 T1 文档）。
