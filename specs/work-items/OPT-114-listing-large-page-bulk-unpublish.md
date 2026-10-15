# Task Packet：OPT-114 房源列表大分页 + 批量动作分批执行

> 状态：**已实施，待合并**（方案 2026-10-15 用户审阅通过）
> 创建日期：2026-10-15
> 分支：`feat/opt-114-listing-bulk-unpublish-417b`
> 来源：用户需求「一个楼盘几百套房源，只留 10 套上架、其余全部下架，现在批量下架还是很麻烦」

**目标：** 一个楼盘 500 套已上架房源、只保留 10 套时，运营在一页里完成：全选 → 取消要保留的 10 套 → 批量下架 → 填一次原因 → 确认，而不是分 5 页重复 5 遍。

**做法（用户选定方案 C「大分页，最小改动」）：**

- 房源列表每页条数加 200 / 500 两档。
- 批量弹层把勾选条目切成每批 ≤ 100 条，**串行**调用 OPT-113 现有的 `POST /api/listings/batch-publish`，显示进度、汇总逐条结果。
- 服务端批量接口单次上限 **保持 100 不变**——每次请求的规模与 OPT-113 验证过的一致，不引入「一次请求串行写 490 条」的超时与连接池风险。
- 列表查询只取列表要用的字段，关联只展开楼盘名、商户名，避免 500 行 × 全量关联展开。

---

## 1. 现状（2026-10-15，master `d3b52313`）

| # | 事实 | 位置 |
|---|---|---|
| E1 | 每页条数白名单 `[10, 25, 50, 100]`，非白名单值回落默认 25 | `src/components/admin/ListingsListView.tsx` 的 `PAGE_SIZE_OPTIONS` |
| E2 | 客户端分页下拉 `sizeOptions: [10, 25, 50, 100]` | `src/components/admin/ListingsListViewClient.tsx` |
| E3 | 勾选只在当前页有效（以「当前行 id 串」为键，翻页 / 改筛选即作废）；表头全选 = 全选当前页 | 同上，`selection` / `rowsKey` |
| E4 | 批量接口单次上限 `BATCH_ACTION_MAX_ITEMS = 100`，注释写「= 列表单页上限」 | `src/domain/shared/batch-request.ts` |
| E5 | 批量端点逐条**串行**执行（注释：并发会同时占住多条连接） | `src/endpoints/listing-batch-publish-endpoint.ts` |
| E6 | 批量弹层一次 `fetch` 发全部条目；全成功 toast 关闭，有失败进结果段 | `src/components/admin/BatchActionModal.tsx`（楼盘库 / 房源列表共用） |
| E7 | 列表查询 `depth: 1` 且不带 `select`：每条房源的全部关联（楼盘、商户、封面、图集等）都被展开 | `ListingsListView.tsx` 的 `payload.find` |

现状下 500 套保留 10 套：每页最多 100 → 5 页 × 「全选 → 找出本页要保留的取消 → 批量下架 → 填原因 → 确认」。

## 2. 决策

- **D1 每页条数白名单改为 `[10, 25, 50, 100, 200, 500]`**，默认仍 25。只改房源列表；楼盘库列表不动。
- **D2 服务端单次上限保持 100**，`BATCH_ACTION_MAX_ITEMS` 不改。分批在客户端做：
  - 每批 ≤ 100 条，**一批返回后再发下一批**（不并发，与 E5 同理由）。
  - 下架原因、动作参数每批相同；乐观锁版本号随条目各自携带（沿用 OPT-113）。
- **D3 某批失败即停**：HTTP 非 2xx、网络异常、响应形状不对，任一发生就不再发后续批次。结果段展示：
  - 已执行批次的逐条结果（成功数 / 失败条目及原因，与现在一致）；
  - 「另有 N 条未执行：<原因>」。
  - 关闭弹层照常刷新列表、清空勾选（运营据此看清实际状态）。
  - 第一批就 401 / 403 时保持现有文案「没有执行该操作的权限」。
- **D4 进度**：总条目 > 100（即多于一批）时，提交中在弹层正文显示「已处理 X / N 条」，X 按已返回批次累计。单批时不显示，与现状一致。
- **D5 列表查询瘦身**：`payload.find` 加 `select`（只取 `ListingRow` 用到的字段）+ `populate`（`buildings` / `merchants` 只取 `name`）。行映射逻辑不变。对所有每页条数生效，不只 500。
- **D6 不变的规则**：勾选仍只在当前页；跳过预筛、下架状态机、原因必填、审计、乐观锁全部沿用 OPT-113；批量上架也走同一套分批逻辑（共用弹层），无需额外改动。
- **D7 已知限制**：单楼盘已上架超过 500 套时，需分两页各做一次。不做跨页勾选（OPT-113 D7 的理由仍成立）。

## 3. 范围

### 做

1. `src/domain/shared/batch-request.ts`：
   - `chunkBatchItems(items, size)`：按序切片，纯函数。
   - `runChunkedBatch({ items, chunkSize, send, onProgress })`：串行发送、累计结果、遇失败即停，返回 `{ results, notRun: { count, error } | null }`。`send` 由调用方注入（弹层里是 `fetch`），便于不起 DOM 单测。
   - 文件头注释改正 E4 那句「上限 100 = 列表单页上限」。
2. `src/components/admin/BatchActionModal.tsx`：提交改走 `runChunkedBatch`；提交中显示进度（D4）；结果段增加「另有 N 条未执行」（D3）。
3. 每页条数（D1）：
   - 白名单与解析抽成纯函数（如 `resolveListingPageSize`），放在 `listings-list-conditions.ts` 旁，单测覆盖；
   - `ListingsListView.tsx` 用它；`ListingsListViewClient.tsx` 的 `sizeOptions` 同源取值，不再各写一份。
4. 列表查询瘦身（D5）。
5. 验证证据写入 `artifacts/verification/OPT-114/`。

### 不做

- 不改服务端批量上限、不新增端点、不加迁移、不改权限码。
- 不做跨页勾选 / 「保留模式」（方案 A，用户未选）。
- 不改楼盘库列表的每页条数。

## 4. 实施步骤（TDD）

1. **分批纯函数**：先写 `chunkBatchItems` / `runChunkedBatch` 的失败单测——空数组、恰好 100、101、490（→ 100×4 + 90，保序）、第 3 批失败即停且 `notRun.count` 正确、进度回调按批累计、全部成功 `notRun = null`；再实现到全绿。
2. **每页条数**：先写 `resolveListingPageSize` 单测（白名单内原样、200 / 500 放行、1000 / 非数字 / 缺省回落 25），再实现，并让服务端与客户端共用常量。
3. **弹层接入**：`BatchActionModal` 改用 `runChunkedBatch`，加进度与「未执行」展示。既有 OPT-113 E2E（`tests/e2e/list-batch-actions.spec.ts`）必须保持全绿——单批路径行为不变。
4. **查询瘦身**：加 `select` / `populate`，以 `node_modules/payload` 的类型为准；核对列表各列（楼盘名、商户名、房间号、状态标签、首页推荐开关、操作列）显示不变。
5. 本地预检：`generate:types` → `typecheck` → `lint` → `test` → `build`。

## 5. 验证

详见 `artifacts/verification/OPT-114/verification.md`。

- [x] 单测：分批 / 停止 / 进度 / 合并；每页条数白名单；另加 select 覆盖行映射的读源码契约（做过变异验证）。全量 6237 条全过。
- [x] 既有 E2E `list-batch-actions.spec.ts` 与相邻列表 E2E 全绿（须先把 500 套夹具移进回收站，原因见验证记录 §2 / §6）。
- [x] **本地 500 套实测**（脚本只写本地库，启动前校验 `DATABASE_URL` 指向 localhost）：造一个含 500 套已上架房源的测试楼盘，浏览器里走一遍——
  - 楼盘筛选 + 已上架 + 每页 500，记录首屏加载耗时；
  - 全选 → 取消 10 套 → 批量下架 → 填原因 → 确认，截图进度态，记录总耗时；
  - 刷新后该楼盘已上架恰为那 10 套；抽查审计行带原因。
  - 若 500 行表格交互明显卡顿（勾选 / 滚动 > 1s），记录数据，再决定是否启用表格虚拟滚动（另议，不在本项默认范围）。
    → 生产模式复测：每页 500 条 TTFB 258–329 ms；单次勾选的事件处理 + React 提交 43–55 ms；490 条批量下架 25.3 s。不启用虚拟滚动。
- [x] 失败即停：用浏览器拦截让第 2 批返回 500，确认结果段显示「已执行 100 条 + 另有 N 条未执行」，关闭后列表刷新。
- [x] 截图：light / dark 两套（确认态、进度态、部分未执行结果态）。
