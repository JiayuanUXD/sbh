# OPT-113 验证记录

> 日期：2026-10-14 ｜ 基线：master `f0c550f` ｜ 环境：本地 PostgreSQL 16（`sbh_dev`，迁移全部应用 + `pnpm seed`），`next dev -p 3717`，Chromium

## 1. 静态与单测

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error；35 条 warning 均为既有（无一条落在本次改动的文件） |
| `pnpm payload generate:importmap` | 「No new imports found」——未注册新的 Payload 组件，importMap 不变 |
| `pnpm test` | 461 / 462 个文件通过，6381 条用例全绿。唯一失败的 `tests/mini-user-assets-postgres.test.ts` 是库名白名单守卫（只认作者本机 / CI 的库名），本地导出 `DATABASE_URL=…/sbh_dev` 时必拒；不带 `DATABASE_URL` 时它被 vitest 配置排除。与本改动无关 |
| 新增单测 | `batch-request`（条目解析 / 预筛 / 响应收口 / 异常收口）、`building-publication`（转移表）、`listing-batch-publish-endpoint`、`building-batch-publish-endpoint`、`effective-supply-labels`；`building-operational-toggle-endpoint` 增 6 条 `target` 用例 |
| 单条发布端点重构 | `tests/listing-publish-endpoint.test.ts` 原 24 条在抽出共享核心前后均全绿（行为不变的证据） |

## 2. 真实接口冒烟（curl，OPS 做批量、ADM 做启停）

| # | 请求 | 结果 |
|---|---|---|
| 1 | OPS 批量下架，不带原因 | 422 `UNPUBLISH_REASON_REQUIRED`，一条未改 |
| 2 | OPS 批量下架 2 条，其中 1 条带过期版本号 | 200：1 成功、1 `VERSION_CONFLICT` |
| 3 | OPS 批量上架（无商户的夹具 + 已发布 ×2） | 200：逐条失败，`reasons: ["NO_SUPPLY_MERCHANT"]` / `ILLEGAL_TRANSITION` |
| 4 | OPS 批量 `mark_leased` | 400「批量操作只支持上架或下架」 |
| 5 | OPS 楼盘批量下架（1 条过期版本号） | 200：1 → `archived`，1 `VERSION_CONFLICT` |
| 6 | OPS 楼盘批量上架（已下架 + 已发布） | 200：1 → `published`，1「当前状态「已发布」不能上架」 |
| 7 | OPS 停用楼盘（无 `building:freeze`） | 403 |
| 8 | ADM `target=disabled` ×2、`target=active` | `changed: true` → `changed: false`（不翻回启用）→ `changed: true` |
| 9 | ADM 不带 body（旧调用方式）×2 | 照旧翻转 |
| 10 | 匿名批量 | 401 |

审计表核对：`listing.unpublish` 一行，`reason = 'OPT-113 冒烟'`；楼盘两行 `building.update`，`changed_fields = ["status"]`。
冒烟时下架过的无商户夹具（10 号）已用 ADM PATCH 复原为已上架。

## 3. 浏览器

### E2E（`tests/e2e/list-batch-actions.spec.ts`，已提交）

```
3 passed (38.3s)
  房源列表：批量下架（原因必填）→ 批量上架（跳过不适用行）
  楼盘库列表：批量下架 / 上架，行内停用 / 启用
  OPS：有批量上下架、无行内停用；直调启停端点 403
```

每步既断言界面（行内状态标签翻新、勾选清空、弹层文案），也用 API 回读库里的状态；`finally` 里复原夹具。
相邻既有用例回归：`listing-publication-actions` + `permission-matrix` + `disabled-supply-not-reachable` 共 27 条全过
（列表加了勾选列后，单行「下架」照常可用）。

> 本机预装 Chromium 版本与仓库 Playwright 1.61 期望的不一致，跑法是临时配置
> `launchOptions.executablePath=/opt/pw-browsers/chromium`（未提交）；CI 用自己安装的浏览器，不受影响。

### 截图（1440×900）

| 文件 | 内容 |
|---|---|
| `light-01-listings-selected.png` | 房源列表勾选 3 行，右上「已选 3 项 / 批量上架 / 批量下架」 |
| `light-02` / `dark-02-listings-batch-unpublish-confirm.png` | 批量下架确认：跳过清单 + 原因必填（为空时确认键禁用） |
| `light-04` / `dark-04-listings-batch-publish-partial-result.png` | 批量上架部分失败：成功 1、未完成 1，原因译成「未设置供给商户」 |
| `dark-07-buildings-batch-unpublish-confirm.png` | 楼盘批量下架确认：说明房源随之前台不可见、房源状态不变 |
| `light-08` / `dark-08-buildings-row-disable-impact.png` | 列表行内停用：先预检「将影响 4 项对外可见记录」 |
| `light-09-building-edit-disable-impact.png` | 编辑页启停按钮改用共享流程后照常预检（回归） |
| `light-10-ops-buildings.png` | OPS 视角：只有批量上下架；没有批量启停与行内「停用」 |
| `light-11-buildings-batch-toolbar.png` | 楼盘库勾选 2 行：批量操作条在筛选行下方单独一行（上下架 ｜ 启用 / 停用），操作列有「停用」 |
| `light-12` / `dark-12-buildings-batch-disable-confirm.png` | 批量停用确认：一次性汇总预检「将影响 5 套对外可见房源」（楼盘 1 的 4 套 + 楼盘 6 的 1 套） |

深色模式：弹层、表格、勾选框无白底残留。

## 4. 已知问题（既有，未在本项修）

- 深色模式下 `custom.scss` 用 `.arco-typography { color: var(--color-text-1) !important }` 一刀切，
  `<Text type="error">` 的红色被压成正文色。批量结果弹层的失败原因、以及既有单条下架弹层的错误文案都受影响（见 `dark-04`）。
  信息仍完整可读，只是失去红色强调。修法是在该深色块里给 `.arco-typography-error` 单独放行，属全局主题改动，建议另开工作项。
- 列表批量勾选只在当前页内有效（D7），一次最多 100 条。

## 5. 追加：批量停用 / 启用（用户追加「停用也做批量」）

### 静态与单测

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm lint` | 通过；lint 0 error，35 条 warning 与追加前完全相同 |
| `pnpm test`（常规方式，不带 `DATABASE_URL`） | 451 / 451 个文件，6157 条全过 |
| `pnpm build` | 通过 |
| `pnpm migrate:drift` | 「config 与最新快照一致」——只注册了端点，无表结构变化，无需迁移 |
| 新增 / 改动单测 | `building-batch-operational-endpoint`（权限、target 校验、逐条停用 / 启用、幂等不写、版本冲突、抛错隔离、审计动作、批量预检）；`building-references` 增 5 条汇总预检；`building-operational-toggle-endpoint` 增 2 条审计 |

### 真实接口冒烟

| # | 请求 | 结果 |
|---|---|---|
| 1 | ADM 批量预检楼盘 1、2、6 | `total 5`，`byBuilding` = 4 / 0 / 1，`capped false` |
| 2 | 单楼盘预检楼盘 1（对照） | `total 4`——与汇总里楼盘 1 的计数一致 |
| 3 | OPS 批量预检 / 批量停用 | 均 403「缺少操作权限：building:freeze」 |
| 4 | ADM 批量停用 2、6（过期版本号）、99 | 2 → disabled；6 `VERSION_CONFLICT`；99「楼盘不存在」 |
| 5 | ADM 再次批量停用 2 | 幂等成功，不写库、不写审计 |
| 6 | ADM 批量启用 2 | → active |
| 7 | ADM 单条不带 body 翻转两次 | 照旧翻转（旧调用兼容） |
| 8 | `target: "toggle"` | 400 |

审计表核对：`building.freeze` / `building.restore` 各两行（批量 2 号、单条 3 号），`changed_fields = ["operationalStatus"]`。
**单条启停（编辑页 / 列表行）从此也写这两种审计**，此前只有 `lastModifiedBy`。冒烟后夹具楼盘全部恢复为启用。

> 冒烟途中本机 PostgreSQL 服务停过一次（`ECONNREFUSED 5432`），`service postgresql start` 后数据完好，与代码无关。

### 浏览器

`tests/e2e/list-batch-actions.spec.ts` 增至 4 条（新增「批量停用（汇总预检）→ 批量启用（跳过已启用行）」，
OPS 用例补「看不到批量启停、直调批量端点 403」），连同 `listing-publication-actions` 共 7 / 7 通过。

批量操作条原先挤在筛选行右侧，加上启停两个按钮后 1440 视口下把筛选与按钮一起挤到折行（实测按钮纵坐标与搜索框不一致）。
已挪到筛选行下方单独一行（`BatchActionBar`，两张列表共用），复测同一行、不折行。
