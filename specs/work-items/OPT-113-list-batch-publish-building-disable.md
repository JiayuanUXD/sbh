# Task Packet：OPT-113 楼盘 / 房源列表批量上下架，楼盘库列表停用

> 状态：**已实施，待合并**
> 创建日期：2026-10-14
> 来源：用户需求「楼盘和房源列表增加批量上/下架功能，楼盘库列表增加"停用"功能」

**目标：** 运营在两张后台列表里勾选多行，一次完成上架 / 下架；楼盘库列表的操作列可以直接停用（或重新启用）楼盘，不必逐个进编辑页。

**做法：** 规则全部留在服务端，列表只负责勾选、确认和展示逐条结果。

- 房源：新增批量端点，逐条复用单条发布端点的同一个核心函数（状态机、审核前置、有效供给、乐观锁、下架原因、审计全部同源）。
- 楼盘：新增批量端点，发布状态 `status` 在 `published` 与 `archived` 之间切换；转移规则写成纯函数。
- 楼盘停用：操作列复用编辑页的停用确认弹层（先预检受影响房源数，再确认）；启停端点加可选的目标状态参数，列表数据过期时不会把「停用」误执行成「启用」。

---

## 1. 现状（2026-10-14，master `f0c550f`）

| # | 事实 | 位置 |
|---|---|---|
| E1 | 房源列表只有单行「下架」，没有勾选；单条发布走 `POST /api/listings/:id/publish` | `src/components/admin/ListingsListViewClient.tsx`、`src/endpoints/listing-publish-endpoint.ts` |
| E2 | 楼盘发布状态 `status`（草稿 / 已发布 / 下架）只能在编辑页改，没有专用端点，写权限是 `building:update` | `src/collections/Buildings.ts` 的 `status` 字段与 `access.update` |
| E3 | 楼盘启停是独立的 `operationalStatus` 轴，端点是**翻转**语义（不看调用方以为的当前状态），权限 `building:freeze` | `src/endpoints/building-operational-toggle-endpoint.ts` |
| E4 | 楼盘库列表注释写明「启停保留在编辑页，不在列表行内快捷切换」——本需求推翻这条，停用入口进列表 | `src/components/admin/BuildingsListViewClient.tsx` 文件头 |
| E5 | 自定义端点没有请求级事务；每次 `payload.update({ req })` 自开自提事务，批量循环里一条失败不连累其它条 | `node_modules/payload/dist/utilities/{initTransaction,commitTransaction}.js`、`handleEndpoints.js` 无事务包装 |
| E6 | 审计动作是 PG 枚举；`building.update` 已在枚举里，新动作要迁移 | `src/domain/audit/audit-types.ts`、迁移 `enum_audit_logs_action` |

## 2. 决策

- **D1 房源批量只给「上架」「下架」**，不给「标记已租 / 已售」：成交是不可逆终态，批量点错没有回头路。
- **D2 房源批量上架逐条过同一套前置门**（审核通过 + 有效供给）。不满足的条目不改状态，结果里逐条列原因；不是全有或全无。
- **D3 房源批量下架收一次原因**，同一原因写进每条的审计。
- **D4 楼盘「上架」= `status → published`（来自草稿或下架），「下架」= `published → archived`。** 权限用 `building:update`——和编辑页改这个字段的门槛一致，批量不比单条更宽也不更严。每条写一行 `building.update` 审计（复用已有枚举值，无迁移）。
- **D5 楼盘停用放在操作列逐行做，不做批量停用。** 停用前要看受影响房源数，逐行预检才说得清；批量停用另立工作项。
- **D6 启停端点新增可选 `target`**：带了就按目标值写，当前已是目标值则幂等返回 `changed: false`，不翻转。编辑页与列表都带 `target`；不带时保持原翻转语义，兼容旧调用方。
- **D7 一次最多 100 条**（列表单页上限），勾选只在当前页内有效，翻页 / 改筛选即清空，免得运营对着看不见的行做操作。
- **D8 列表先按状态机预筛**：勾选里不适用的条目（已上架的再上架、草稿下架等）在确认弹层里明示「将跳过 N 条」，不发给端点；端点仍逐条再校验。

## 3. 范围

### 做

1. `src/domain/shared/batch-request.ts`：解析并校验批量条目（去重、上限、ID / 版本号类型）。纯函数 + 单测。
2. `src/domain/supply/building-publication.ts`：楼盘上下架转移规则。纯函数 + 单测。
3. `src/domain/listing/listing-publish-action.ts`：从单条端点抽出核心执行函数；单条端点改为调用它，行为不变（既有单测全绿即证明）。
4. `POST /api/listings/batch-publish`、`POST /api/buildings/batch-publish`：鉴权一次、逐条执行、返回逐条结果。
5. 启停端点 `target` 参数。
6. 列表 UI：勾选、批量操作条、确认弹层（含逐条结果）、楼盘行内停用 / 启用。

### 不做

- 批量停用楼盘（D5）、批量标记成交（D1）、跨页勾选（D7）。
- 新审计枚举值 / 迁移。
- 楼盘停用写审计：单条启停端点原本就只记 `lastModifiedBy`，不在本项扩。

## 4. 验证

详见 `artifacts/verification/OPT-113/verification.md`。摘要：

- [x] `pnpm typecheck` / `pnpm lint`（0 error，无新增 warning）/ `pnpm test`（6381 条全绿；唯一红的是与本项无关的库名白名单守卫）。
- [x] 真实接口冒烟 10 项（缺原因 422、逐条版本冲突、逐条前置门、批量拒成交动作、楼盘转移、OPS 停用 403、`target` 幂等、旧调用兼容、匿名 401），审计行核对。
- [x] 浏览器 E2E `tests/e2e/list-batch-actions.spec.ts` 3/3；相邻既有 E2E 27/27。
- [x] 截图：light / dark 两套，含部分失败结果弹层、停用预检、OPS 视角。

## 5. 已知问题（既有，未在本项修）

- 深色模式下 `custom.scss` 把所有 `.arco-typography` 强制成正文色，`<Text type="error">` 不再是红色（批量结果弹层与既有单条下架弹层都受影响，信息仍可读）。建议另开工作项。
