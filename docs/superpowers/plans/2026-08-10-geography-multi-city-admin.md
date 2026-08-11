# 后台地理数据管理重构 —— 产品方案与实施计划

> **For agentic workers:** 本文件既是产品方案（Part A）也是可执行计划（Part B）。逐 Task 推进，用 `- [ ]` 勾选跟踪，一个 Task 一个 commit。Part A 的决策已定稿，**不要重新讨论方案选型**，直接按 Part B 实施。

**Goal:** 把后台「行政区域 / 商圈管理」两个混乱入口，重构为**城市 / 行政区域 / 商圈 / 地铁**四个彼此独立、数据关联的平铺管理模块，并把地理数据模型从"单城市能跑"改造成"多城市可扩展"。

**Architecture:** `locations` **单表不拆**，新增反范式 `city` 字段解锁城市维度查询；四个模块是四个**自定义 admin 路由**下的平铺列表（各有自己的列与筛选），编辑仍复用 `/admin/collections/locations/:id`；关联数量用**一次聚合 SQL** 批量计算；`business-area-extensions` 表与其全部写侧不变量原样保留，只把编辑入口内嵌进商圈编辑页。

**Tech Stack:** Next.js 16（App Router, RSC）+ Payload 3.86 + PostgreSQL（`push: false`，只走显式迁移）+ Semi Design（后台既有 UI 库）+ Vitest + Playwright。包管理器 **pnpm**。

**分支:** `feat/admin-area-optimization`（已基于 `master` 创建）。

---

# Part A · 产品方案

## A1. 现状与问题

**现状**：「基础配置」下有两个地理入口。

| | 「行政区域」 | 「商圈管理」 |
|---|---|---|
| collection | `locations` | `business-area-extensions` |
| 实际内容 | 城市 / 行政区 / **商圈** / 地铁线路 / 地铁站，一棵固定层级树 | 只有商圈的边界多边形、扩展中心点、别名、关联地铁站 |
| 列表视图 | 自定义树视图整页替换 | Payload 默认列表 |
| 能否新建商圈 | 能 | **不能** |

**六个问题**（P4/P5 是多城市阻塞级）：

- **P1 命名与内容不符。** 菜单叫「行政区域」，装的是整棵树，行政区只是其中一层。运营看到「商圈管理」以为能建商圈，进去只有一个下拉。
- **P2 一个业务实体切成两个页面。** 商圈的名称/封面/启停在 A，边界/别名/站点在 B。商圈从 100 涨到 1000 时，这份导航成本线性叠加。
- **P3 树是数据模型的形状，不是运营任务的形状。** 树只回答"它挂在哪"（低频），无法回答"这条数据完整吗"（高频）。
- **P4 树一次性全量加载，`limit: 2000` 是硬上限，且默认全部展开。**
  单城 ≈ 16 区 + 100 商圈 + 20 线 + 500 站 ≈ **650 节点**。第 4 个城市即逼近上限并**静默截断**（树缺枝不报错）。同时 `buildLocationForest` 无关键词时 `expandedIds` = 全部可展开节点（[location-tree.ts:107](../../../payload-office-platform/src/domain/geography/location-tree.ts)），进页面就渲染 650 个节点。
- **P5 没有反范式 `city` 字段，"按城市"不可索引。** 节点只有 `parent`，解析归属城市要递归上溯（`business-area-extension-protect.ts` 的 `resolveCityId`，最多 8 次 `findByID`）；校验一条含 20 站点的商圈扩展 ≈ **40+ 次单点查询**。`users.cityScope` 已存在，但地理表没有城市维度可 `where`，**城市级数据隔离目前写不出来**。
- **P6 行政区与地铁线路是同层兄弟。** `district.parent = city`、`metro_line.parent = city` → 展开杭州是 13 个行政区 + 12 条线路**混排**，上海是 36 项。

**实测交互路径（改杭州地铁 2 号线）**：进菜单 3 步 → 搜"2号线"命中全国各城同名线路 → 靠区域代码辨认 → 点编辑整页跳走 → 保存返回后树全量重渲染、展开态与搜索词全丢。**6~7 步且状态不可恢复。**

## A2. 方案决策（已定稿）

**核心思路：按运营任务拆模块，而不是按数据层级建树。**

| 决策 | 结论 | 理由 |
|---|---|---|
| 模块划分 | **城市 / 行政区域 / 商圈 / 地铁** 四个独立平铺模块 | 每个模块 = 一种实体 = 一张可扫描的表，回答"这条数据完整吗" |
| 表结构 | **单表 `locations` 不拆**，四个自定义 admin 路由 | 拆三张表要复制引用计数、启停联动、代码唯一性、层级校验四套逻辑；单表 + query preset 又做不到各模块不同的列。自定义路由是唯一两全解 |
| 关联数量 | **一次聚合 SQL 批量算**，不加反范式计数列 | 避免每行 N 次 count（20 行 × 3 计数 = 60 查询/页）与计数列的一致性漂移。**代价：计算列不参与排序与筛选（已接受）** |
| 地铁模块 | **只做线路列表**，站点在线路详情页内嵌管理（可拖排序） | 站点顺序本就是线路属性；500 站的独立平铺列表日常价值低。站点精确查找交给全局搜索 |
| 行政区的地铁线路数 | **一期不做** | 线路挂城市、站点无行政区字段，数据链是断的。要做须给 500+ 站加 `district` 并回填，为一个展示指标不值 |
| 商圈扩展表 | 表与全部写侧不变量原样保留，仅编辑入口内嵌进商圈编辑页 | 不变量用只读字段同样能保证，不必用"分表"来保证 |
| 树 | 从日常入口**降级为城市详情页里的只读层级树** | 保留开城校对价值，不承担日常导航 |

**方案成立的关键前提**：`protectLocation` 已有"移动不可跨城市"硬约束（`location-protect.ts` 规则 3）→ 节点归属城市**一经创建永不改变** → 反范式 `city` 字段**不需要任何级联更新逻辑**。这是整个方案最省事的一点。

**明确不做**：不拆表；不做合表（把 boundary/aliases 搬进 locations）；不做 `cityScope` 数据权限落地（本次只铺字段与索引）；不做地图可视化画边界；不改 C 端任何行为与 URL；不改 `business-area-extensions` 任何写侧不变量与错误码。

## A3. 目标信息架构

```
房源运营 › 基础配置
├─ 城市管理      开城完备度总览 · 详情页含只读层级树
├─ 行政区域      平铺列表
├─ 商圈管理      平铺列表
├─ 地铁管理      线路列表 → 详情内嵌站点排序
└─ 配套字典

全局：Cmd/Ctrl+K 跨类型搜索直达（结果带「城市 / 类型」面包屑）
```

## A4. 各模块列定义

**城市管理** —— 一眼看出每个城市的开城完备度

| 列 | 来源 | 备注 |
|---|---|---|
| 城市名 / 区域代码 | `locations` | |
| 行政区数 | 聚合 | 直接子节点 `type=district` |
| 商圈数 | 聚合 | 该城 `type=business_area` |
| 缺边界商圈数 | 聚合 | 无扩展记录或 `boundary` 为空 |
| 地铁线路数 / 站点数 | 聚合 | |
| 楼盘数 | 聚合 | `buildings` 关联该城任一节点，去重 |
| 状态 / 前台可见 | `locations` | |

**行政区域**：名称 / 区域代码 / **所属城市** / 商圈数 / 楼盘数 / 状态 / 前台可见 / 排序
**商圈管理**：名称 / 区域代码 / **所属行政区** / **所属城市** / 楼盘数 / 关联站点数 / **关联线路数** / 边界✅⚠️ / 封面✅⚠️ / 状态 / 前台可见
**地铁管理**：线路名 / 区域代码 / **所属城市** / 站点数 / 状态 / 排序

> **口径说明（写进代码注释）**：商圈的"关联线路数"= `business-area-extensions.metroStations` 所关联站点的 `parent` 去重计数——关联的是站点不是线路，线路数是反推出来的。

**四个模块统一具备**：城市筛选（默认取当前用户 `cityScope` 首个，其次排序第一个城市）、状态筛选、关键词搜索（名称/代码）、分页、URL 可分享（筛选写进 search params）。

## A5. 目标交互路径

```
改杭州地铁 2 号线：
  地铁管理 → 城市筛选「杭州」→ 12 条线路 → 点开 → 抽屉内改
  = 3 步，不跳出模块，筛选状态不丢
或：
  任意页面 Cmd+K → 输「杭州2」→ 回车
  = 2 步
```
对比现状 6~7 步 + 整页跳走 + 状态丢失。

## A6. 度量

| 指标 | 现状 | 目标 |
|---|---|---|
| 改一个已知地理对象的操作步数 | 6~7 | ≤3 |
| 编辑一个商圈完整信息的页面跳转 | 2 页 | 1 页 |
| 列表首屏加载节点数 | 全库（2000 上限截断） | 单页 20 条 |
| 商圈扩展保存的地理查询次数 | `2 + 2N`（N=站点数） | 常数级 |
| 列表页计数查询次数 | —（现无计数） | 每页 **1 次聚合**，不随行数增长 |

## A7. 七城数据导入（本期范围，阶段五）

开发任务完成后，导入 **上海、杭州、苏州、嘉兴、南京、无锡、宁波** 七城的行政区、商圈、地铁线路、地铁站。

**量级估算**（实际条数以数据源为准，导入前必须核对）

| 城市 | 行政区 | 地铁线路 | 地铁站 | 商圈 |
|---|---|---|---|---|
| 上海 | ~16 | ~21 | ~510 | 待定 |
| 南京 | ~11 | ~13 | ~200 | 待定 |
| 杭州 | ~13 | ~12 | ~250 | 待定 |
| 苏州 | ~9 | ~6 | ~190 | 待定 |
| 无锡 | ~7 | ~5 | ~110 | 待定 |
| 宁波 | ~10 | ~6 | ~110 | 待定 |
| 嘉兴 | ~7 | **0（待核实）** | 0 | 待定 |
| 合计 | **~73** | **~63** | **~1370** | ~200–500 |

**总量约 1700–2000 条**——恰好落在旧树视图 `limit: 2000` 的截断线上，这批数据本身就是本次重构的验收压力测试。

**三类数据的可靠性差异**（决定各自的导入方式）

| 类型 | 权威源 | 难度 |
|---|---|---|
| 行政区 | 民政部 / 国家统计局行政区划代码，唯一权威 | 低，可精确 |
| 地铁线路 + 站点 | 各地地铁官方线网图 / 地图服务商 POI | 中，需人工核对新开段与站名别名 |
| **商圈** | **无权威源** | **高，本质是业务定义**，须先定口径 |

**已定的导入原则**
- 种子数据以 **JSON 文件入库、版本控制**（`payload-office-platform/seed/geography/<city>.json`），可 review、可 diff、可重跑；不用一次性脚本。
- 导入**必须走 Local API**（`payload.create/update`）以过 `protectLocation` hook，**不得直接写库**。
- **幂等键 = `immutableCode`**（DB 已有 unique 约束）；重跑只补差异，不产生重复。
- 导入顺序固定：城市 → 行政区 → 商圈 / 地铁线路 → 地铁站（`parent` 依赖决定）。
- 默认 `status = 'active'`、**`frontendVisible = false`**——导入不等于上前台，可见性由运营逐条开。
- **不做成数据库迁移**：迁移不应依赖外部数据源，且这批数据的回滚语义是业务决定而非 schema 决定。做成可重复执行的脚本，生产由人工执行一次。

## A8. 后续（明确不在本期）

- `users.cityScope` 落地为真正的数据权限过滤——本期的 `city` 字段是其前置条件。
- 给 `metro_station` 加 `district` 字段并回填，解锁"经过某行政区的线路"。
- 商圈边界的地图可视化编辑（本期商圈只导入中心点与名称，`boundary` 留空）。

---

# Part B · 实施计划

## B0. 全局约束（每个 Task 都适用）

- 包管理器是 **pnpm**，不用 npm / yarn。
- **所有 schema 变更必须 `pnpm payload migrate:create` 生成迁移并提交 `src/migrations/`；生成的迁移文件正文绝不手改。** 数据回填另写独立迁移文件（只含 `UPDATE`，无 DDL），这不算手改生成文件。
- 本地 `DATABASE_URL` 必须是 postgres，用**本工作树独立库**（`sbh_dev_geo`），不共用 `sbh_dev`、**绝不指向生产 TencentDB**。
- 本工作树用独立 dev 端口（**不要抢 3717**，用 `PORT=3721 pnpm dev`）。
- 纯函数严格 TDD：先写失败测试 → 跑红 → 实现 → 跑绿 → 提交。
- 提交只用**显式 `git add <具体路径>`**；禁用 `git add -A` / `git add .` / `git commit -am`。仓库里 `payload-office-platform/public/prd/*.md` 处于已删除状态，是用户有意搁置的，**别恢复、别提交**。
- 所有中文文案用**简体中文**，提交信息中文描述同样。
- 后台 UI 复用既有 **Semi Design**（`LocationTreeViewClient` 已在用），**不引新 UI 库**。
- 每个 Task 结束跑 `pnpm test` + `pnpm build`，全绿才提交。
- **不修改任何既有错误码与错误文案**（前端与 E2E 依赖）。

## B1. 两个必须先核对的事实

1. **列名**：`pnpm payload migrate:create` 生成迁移后，去生成的 `.json` 里核对 `city` 字段的实际列名（预期 `city_id`）、父列（预期 `parent_id`）、以及 `metroStations` 关系的中间表名（预期 `business_area_extensions_rels`）。**所有原生 SQL 必须以核对结果为准，不得凭记忆写。**
2. **迁移顺序坑**：数据迁移里若调用 `payload.update` 会触发文档锁检查，要求 `locked_docs_rels` 已有对应列。本计划的回填迁移**只走原生 SQL `UPDATE`**，规避该问题。后续若有人改成 Local API 回填，必须确认 schema 迁移在前。

---

# 阶段一 · 数据基座（Task 1–5）

## Task 1 · `locations.city` 反范式字段

**做什么**：在 `src/collections/Locations.ts` 的 `parent` 字段之后新增

```ts
{
  name: 'city',
  label: '所属城市',
  type: 'relationship',
  relationTo: 'locations',
  index: true,
  admin: {
    readOnly: true,
    description: '由系统按层级自动维护；城市节点本身留空（其城市即自身）。',
  },
},
```

**语义约定（必须写进代码注释，后续所有查询都依赖）**
- 非 city 节点：`city` = 所属城市 id。
- **city 节点自身：`city` 留空**，不自引用。理由：创建时自身 id 未知，自引用需 `afterChange` 回写 + 重入防护，活动部件更多、失败模式更隐蔽。
- 因此"某城市的全部节点（含城市自身）"必须走统一辅助函数，不要各处手写。

**验收**
- [ ] 字段已加，`pnpm payload migrate:create` 生成迁移（含列 + 索引），已提交且正文未手改。
- [ ] 已按 B1.1 核对实际列名并记录在本文件末尾的「实施记录」。
- [ ] `pnpm payload migrate` 本地执行成功，`src/payload-types.ts` 重新生成并提交。

---

## Task 2 · 城市解析纯函数 + 查询辅助（TDD）

**做什么**：新建 `src/domain/geography/location-city.ts`

```ts
/** 「某城市的全部节点（含城市节点自身）」的统一查询条件 */
export function cityScopeWhere(cityId: number | string): Where
// 返回 { or: [{ id: { equals: cityId } }, { city: { equals: cityId } }] }

/** 从摊平节点数组解析某节点的城市 id（纯函数，供测试与前端复用） */
export function resolveCityIdFromFlat(
  nodes: readonly { id: number | string; type: LocationType; parentId: number | string | null }[],
  startId: number | string,
): number | string | null
```

**先写测试** `tests/location-city.test.ts`：城市自身命中；四种非城市类型均能解析；断链返回 `null`；深度超过 8 的病态数据不死循环。

**验收**
- [ ] 测试先红后绿。
- [ ] `location-city.ts` 无 payload / react 依赖（纯函数）。

---

## Task 3 · 写侧维护 `city` + 同城校验降为常数级

**改 `src/domain/geography/location-protect.ts`**
1. `resolveCityId(req, startId)` 改为**优先读父节点的 `city` 字段**——父节点 `city` 已填好，一跳即得；仅当父节点 `city` 为空（说明父是城市节点）时取 `parent.id`。O(深度) → O(1)。
2. `beforeChange` 末尾写入 `data.city = childType === 'city' ? null : await resolveCityId(req, parentId)`。
3. 非 city 节点解析不出城市 → 抛 `InvalidOperationError`（**新错误码** `CITY_UNRESOLVED`），不允许落库孤儿节点。

**改 `src/domain/geography/business-area-extension-protect.ts`**
4. 站点同城校验从"两次递归上溯"改为**直接比对 `areaNode.city` 与 `station.city`**；任一为空视为数据异常并报错。
5. 站点批量校验从 `for` 循环逐个 `findByID` 改为一次 `payload.find({ where: { id: { in: stationIds } } })`。

**验收**
- [ ] `tests/location-protect.test.ts` 补：各类型新建后 `data.city` 正确；city 节点 `city` 为空；父级缺失抛 `CITY_UNRESOLVED`。
- [ ] `tests/business-area-extension-protect.test.ts` 补：跨城站点仍被拒（**错误码 `INVALID_STATION_RELATION` 与文案保持不变**）；同城通过；断言查询次数不随站点数线性增长。
- [ ] 全部 geography 测试绿。

---

## Task 4 · 存量数据回填迁移

**做什么**：新建手写迁移 `src/migrations/<timestamp>_backfill_location_city.ts`，只含 `UPDATE`，无 DDL，参照 `20260810_170000_public_page_performance_indexes.ts` 的写法：

```ts
import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id, id AS city_id FROM "locations" WHERE "type" = 'city'
      UNION ALL
      SELECT l.id, t.city_id FROM "locations" l JOIN tree t ON l."parent_id" = t.id
    )
    UPDATE "locations" SET "city_id" = tree.city_id
    FROM tree
    WHERE "locations".id = tree.id AND "locations"."type" <> 'city';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`UPDATE "locations" SET "city_id" = NULL;`)
}
```

**验收**
- [ ] 列名已按 B1.1 核对，非猜测。
- [ ] 本地灌入 ≥2 城样例数据（每城含全部 5 种类型）后执行，`SELECT count(*) FROM locations WHERE type <> 'city' AND city_id IS NULL` = **0**。
- [ ] 存在孤儿节点（parent 断链）时，回填后跑校验 SQL 输出清单，人工修数据。
- [ ] `down` 可回滚；`pnpm payload migrate` 从空库完整顺序跑通。

---

## Task 5 · 聚合计数服务

**做什么**：新建 `src/domain/geography/location-counts.ts`，**全部原生 SQL 集中在此文件**，通过 postgres adapter 的 drizzle 实例执行（`payload.db.drizzle`）。

```ts
export type CityCounts = {
  districts: number; businessAreas: number; businessAreasMissingBoundary: number
  metroLines: number; metroStations: number; buildings: number
}
export type DistrictCounts = { businessAreas: number; buildings: number }
export type BusinessAreaCounts = { buildings: number; stations: number; metroLines: number }
export type MetroLineCounts = { stations: number }

/** 一次查询批量取计数，返回 Map<locationId, Counts>；ids 为空时直接返回空 Map，不打库 */
export async function countForCities(payload: Payload, ids: readonly (number|string)[]): Promise<Map<...>>
export async function countForDistricts(...): Promise<Map<...>>
export async function countForBusinessAreas(...): Promise<Map<...>>
export async function countForMetroLines(...): Promise<Map<...>>
```

**实现约束**
- 每个函数**只发 1~2 条 SQL**（`WHERE id = ANY($ids) GROUP BY`），不得在循环里查询。
- `buildings` 计数必须过滤软删除（`deleted_at IS NULL`）与该表既有的可见性条件——去 `Buildings.ts` 核对字段名后照搬，不要自创条件。
- 商圈的 `stations` / `metroLines` 走 `metroStations` 的关系中间表（表名按 B1.1 核对）；`metroLines` = 站点 `parent_id` 去重计数。
- "缺边界商圈" = 该商圈无扩展记录，**或**扩展记录 `boundary` 为 `NULL` / 空对象。
- **原生 SQL 绕过 access control**：这些只是聚合数字，不含敏感字段，可接受；但**不得**用它返回任何行级明细。在文件头注释里写明这条边界。
- 把"SQL 结果行 → Map"的整形逻辑抽成纯函数，单测覆盖。

**验收**
- [ ] `tests/location-counts.test.ts`：整形纯函数覆盖空结果、缺失 id（补 0）、去重计数。
- [ ] 真实库集成验证：造 2 城数据，四个函数返回值与手工 SQL 一致。
- [ ] 用 `EXPLAIN` 或日志确认每次调用的 SQL 条数不随 ids 长度增长。

---

# 阶段二 · 四个管理模块（Task 6–10）

## Task 6 · 自定义 admin 路由骨架 + 共享列表组件

**做什么**

1. 在 `src/payload.config.ts` 的 `admin.components.views` 注册四个自定义视图路由：
   `/geography/cities`、`/geography/districts`、`/geography/business-areas`、`/geography/metro-lines`。
   > Payload 3 自定义 admin 视图的注册键与 `path` 写法以**安装版本 3.86 的实际类型定义为准**（`node_modules/payload` 里的 `AdminViewConfig`）。本仓库此前没有自定义 admin 路由先例，实现前先读类型定义确认，不要照抄旧版文档。

2. 新建共享组件 `src/components/admin/geography/GeographyListView.tsx`（server）+ `GeographyListViewClient.tsx`（client），四个模块传入不同配置即可：

```ts
type GeographyModuleConfig = {
  type: LocationType
  title: string
  columns: ColumnDef[]        // 含「计算列」标记，计算列不可排序（A2 决策）
  filters: ('city' | 'district' | 'status' | 'keyword')[]
  emptyHint: string
}
```

3. 服务端流程：解析 search params（`city` / `status` / `q` / `page` / `parent`）→ `payload.find({ collection: 'locations', where, limit: 20, page })` → 拿到本页 ids → 调 Task 5 的对应计数函数（**一次聚合**）→ 合并后传给 client。
4. 客户端：Semi `Table` + 筛选栏 + 分页；**所有筛选写进 URL search params**（可分享、后退可用）；行点击打开右侧**抽屉**做轻量编辑（名称/状态/排序/前台可见/坐标），"完整编辑"按钮跳 `/admin/collections/locations/:id`。
5. 抽屉保存走 `PATCH /api/locations/:id`，**带 `version` 乐观锁**，冲突时展示后端返回的 `VersionConflictError` 文案，不静默覆盖。

**验收**
- [x] 四个路由可访问，未登录跳登录。（Playwright：匿名访问 4 路由均跳 `/admin/login?redirect=...` 且零数据泄漏；登录后正常渲染。注：Payload 3.86 `isCustomAdminView` 把自定义视图当公共路由、不自动加认证门槛，已在共享 server 组件 `GeographyListView.tsx` 顶层补 `req.user` 判定 + `redirect()`，一处保护四路由。）
- [x] 筛选与分页状态完整反映在 URL，刷新与后退行为正确。（筛选写进 URL search params，`router.push` 携带，刷新/后退保真。）
- [x] 抽屉保存成功后列表原地刷新，筛选不丢。（PATCH 带 `version` 乐观锁，成功后 `Message.success('已保存')` + `router.refresh()` 保留筛选。）
- [x] 计算列表头无排序控件（明确不可排序，不是坏掉的排序）。（计算列标记 `sortable: false`，表头无排序箭头。）

---

## Task 7 · 城市管理模块

**列**：城市名 / 区域代码 / 行政区数 / 商圈数 / 缺边界商圈数 / 地铁线路数 / 站点数 / 楼盘数 / 状态 / 前台可见
**筛选**：状态、关键词。（城市模块本身不需要城市筛选。）

**城市详情页**：新建 `/geography/cities/:id`，含
- 该城完备度卡片（同上计数，缺边界商圈数 > 0 时高亮）
- **只读层级树**：复用 `src/domain/geography/location-tree.ts` 纯函数与现有渲染，数据源 `cityScopeWhere(cityId)`，**默认只展开到城市下一层**（不是全展开），子节点按类型分组显示「行政区 (13)」「地铁线路 (12)」两个虚拟分组节点（纯渲染层，不入库）。
- 树节点点击 → 跳对应模块并定位该条。

**验收**
- [x] 2 城数据下计数正确（与手工 SQL 核对）。
- [x] 只读树默认展开一层，类型分组正确，节点数与该城实际一致。
- [x] 树是只读的——无编辑/新建入口，避免与模块页职责重叠。

---

## Task 8 · 行政区域模块

**列**：名称 / 区域代码 / 所属城市 / 商圈数 / 楼盘数 / 状态 / 前台可见 / 排序
**筛选**：城市、状态、关键词
**新建**：跳 `/admin/collections/locations/create`，预填 `type=district` 与当前筛选的城市作为 `parent`。

**验收**
- [x] 切换城市筛选列表正确变化，URL 可分享。
- [x] 新建预填正确，保存后 `city` 字段由 hook 自动填对。
- [x] 楼盘数与 `buildings.district` 实际关联数一致（含软删除过滤）。

---

## Task 9 · 商圈管理模块

**列**：名称 / 区域代码 / 所属行政区 / 所属城市 / 楼盘数 / 关联站点数 / 关联线路数 / 边界 ✅⚠️ / 封面 ✅⚠️ / 状态 / 前台可见
**筛选**：城市、行政区（随城市联动）、状态、关键词、**「仅看缺边界」/「仅看缺封面」快捷 chip**

**验收**
- [x] 行政区筛选项随城市联动，切城市后重置。
- [x] 「仅看缺边界」结果与 Task 5 的 `businessAreasMissingBoundary` 口径完全一致。
- [x] 关联线路数为去重后的线路数，不是站点数。

---

## Task 10 · 地铁管理模块

**列**：线路名 / 区域代码 / 所属城市 / 站点数 / 状态 / 排序
**筛选**：城市、状态、关键词
**站点不做独立列表**（A2 决策），站点的精确查找靠 Task 13 的全局搜索。

**验收**
- [ ] 站点数正确。
- [ ] 列表页不出现任何站点行。

---

# 阶段三 · 编辑体验（Task 11–14）

## Task 11 · 商圈扩展面板内嵌进商圈编辑页

**做什么**
1. 新建 `src/components/admin/BusinessAreaExtensionPanel.tsx`（client），编辑 `boundary` / `extendedCenterLatitude` / `extendedCenterLongitude` / `aliases` / `metroStations`，带 `version` 乐观锁。
   - 读：`GET /api/business-area-extensions?where[businessArea][equals]=<id>&limit=1`
   - 无记录 → 表单为空，首次保存 `POST` 并带 `businessArea`；已有 → `PATCH`。
   - `metroStations` 候选用 Task 1 的 `city` 字段过滤：`where[type][equals]=metro_station&where[status][equals]=active&where[city][equals]=<商圈的 cityId>`。**这是加 `city` 字段的直接兑现点。**
2. 在 `Locations.ts` 字段末尾挂 UI 字段：

```ts
{
  name: 'businessAreaExtension',
  type: 'ui',
  admin: {
    condition: (data) => data?.type === 'business_area' && Boolean(data?.id),
    components: { Field: '/components/admin/BusinessAreaExtensionPanel' },
  },
},
```

3. `BusinessAreaExtensions.ts` 加 `admin.hidden: true`（从 Payload 自带导航隐藏，**collection 与 hook 全部保留**，直接 URL 仍可访问用于排障）；`admin.description` 改为「本页仅供排障；日常配置请在「商圈管理」中打开对应商圈」；`defaultColumns` 改为 `['businessArea', 'boundary', 'aliases', 'updatedAt']`（去掉经纬度与版本号）。

**边界**：**不改 `protectBusinessAreaExtension` 的任何不变量与错误码**，面板只是换入口。新建商圈时（无 id）不显示面板，提示"保存后可配置空间信息"。

**验收**
- [ ] 商圈编辑页可完成扩展的新建与更新，刷新后数据正确。
- [ ] 跨城/停用站点候选里不出现；**用 REST 强行提交仍被后端拒绝**（不变量未被绕过）。
- [ ] 两标签页并发编辑触发版本冲突并正确报错。
- [ ] 非商圈类型节点不显示该面板。

---

## Task 12 · 地铁线路的站点内嵌面板

**做什么**：新建 `src/components/admin/MetroLineStationsPanel.tsx`，挂在 `Locations.ts` 的 UI 字段上，`condition: (data) => data?.type === 'metro_line' && Boolean(data?.id)`。

能力：列出该线路全部站点（按 `sortOrder`）；**拖拽排序**（保存时批量 `PATCH` 各站 `sortOrder`）；快速新增站点（只填名称 + 区域代码，`parent` 与 `city` 自动带上）；单站启停。

**约束**：批量排序保存必须**逐条串行 PATCH 或分批**，每条都会过 `protectLocation` hook；不要试图绕过 hook 直接写库。失败时明确提示哪几条没保存成功，不做静默部分成功。

**验收**
- [ ] 拖拽排序保存后刷新顺序正确。
- [ ] 新增站点的 `parent`、`city`、`type` 自动正确。
- [ ] 中途失败有明确的逐条结果反馈。

---

## Task 13 · 全局搜索（Cmd/Ctrl + K）

**做什么**
1. 在 `Locations.ts` 的 `endpoints` 里新增（**必须挂 collection，不能放顶层 `config.endpoints`，否则被 slug 路由遮蔽 → 404**）：
   `GET /api/locations/search?q=<keyword>&limit=20`
   - 按 `name` / `immutableCode` 模糊匹配，返回 `{ id, name, type, cityId, cityName, parentName }`。
   - 走登录态与数据权限（`overrideAccess: false`）。
   - `q` 去空格后长度 < 2 直接返回空数组，**不打库**。
2. 新建 `src/components/admin/GeographyQuickSearch.tsx`，挂 `admin.components.actions`，`Cmd/Ctrl+K` 唤起。结果**按城市分组**并显示类型标签：

```
杭州市 / 地铁2号线      METRO-HZ-L2
上海市 / 地铁2号线      METRO-SH-L2
```
   回车进对应模块的编辑抽屉；`Esc` 关闭；上下键导航。

**验收**
- [ ] `tests/location-route-api.test.ts` 风格补测：命中、空串、短词不打库、跨城同名区分、未登录拒绝。
- [ ] 真实 dev server 上 `curl` 通过。
- [ ] 快捷键在后台任意页面可用，不与浏览器默认行为冲突（`preventDefault`）。

---

## Task 14 · 编辑页按类型收敛字段

**做什么**：给 `Locations.ts` 的字段加 `admin.condition`，按 `type` 只显示相关字段。

| 字段 | 显示于 |
|---|---|
| `parent` | 非 city |
| `coverImage` / `description` | business_area、district |
| `centerLatitude` / `centerLongitude` | 全部（城市也需要） |
| `businessAreaExtension` 面板 | business_area |
| `metroLineStations` 面板 | metro_line |

`type` 与 `immutableCode` 在编辑态设为只读（已有 hook 保证不可变，这里让 UI 与之一致）。

**验收**
- [ ] 各类型编辑页只出现相关字段。
- [ ] 只读字段无法在 UI 上修改；后端不可变校验保持不变。

---

# 阶段四 · 收尾（Task 15–17）

## Task 15 · 导航改造与权限编码

**做什么**：改 `src/domain/admin-navigation/navigation-config.ts:67`

```ts
subgroup('supply-settings', '基础配置', [
  leaf('cities', '城市管理', '/admin/geography/cities', ['locations']),
  leaf('districts', '行政区域', '/admin/geography/districts', ['locations']),
  leaf('business-areas', '商圈管理', '/admin/geography/business-areas', ['business-areas']),
  leaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations']),
  leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
]),
```

> 注意 `leaf()` 会从 href 推导 `collectionSlug`，这四个 href 不是 `/admin/collections/:slug` 形式，推导结果为 `undefined`。若下游（权限过滤、badge）依赖 `collectionSlug`，显式传 `{ collectionSlug: 'locations' }`。**实现前先读 `navigation-types.ts` 与消费方，确认是否必需。**

**⚠️ 权限数据兼容（必须照做）**
`'business-areas'` 是 `src/domain/auth/permission-codes.ts:37` 的 `MENU_CODES` 成员，已写进生产角色数据（见 `20260728_180000_opt_021_admin_navigation_roles.ts:71`、`20260808_224000_articles_menu_for_ops.ts`、`src/test/factory/roles.ts:60`）。
- **不新增 menu code**，四个模块复用 `locations` / `business-areas` 两个既有 code，**零数据迁移**。
- **不删除任何既有 code。**

**验收**
- [ ] 含 `business-areas` 与 `locations` 的存量角色登录后台，导航与角色页均无报错。
- [ ] 「基础配置」下 5 项，顺序如上。
- [ ] 全量 Vitest 绿（`permission-codes` 完整性测试会覆盖）。

---

## Task 16 · 旧树视图下线

**做什么**
- 移除 `Locations.ts` 的 `admin.components.views.list`（恢复 Payload 默认列表，作为排障兜底）。
- `Locations.labels.plural` 改为 `'地理数据'`（面包屑用，不再出现在导航）。
- 删除 `src/components/admin/LocationTreeView.tsx`；`LocationTreeViewClient.tsx` **保留但改造为只读**，供 Task 7 的城市详情页复用（去掉编辑/新增按钮，去掉"全部展开"默认行为）。
- `src/domain/geography/location-tree.ts` **不动**，其单测 `tests/location-tree.test.ts` 必须保持全绿。

**验收**
- [ ] `/admin/collections/locations` 是可用的默认列表（排障入口）。
- [ ] 无死代码残留（`pnpm build` 无未使用导入告警）。
- [ ] `tests/location-tree.test.ts` 全绿且未修改。

---

## Task 17 · E2E 与最终验收

**做什么**：新增 `tests/e2e/geography-admin.spec.ts`

1. 登录 → 断言「基础配置」下有 5 项，且**不存在**指向 `/admin/collections/business-area-extensions` 的菜单项。
2. 城市管理 → 断言完备度计数与灌入数据一致。
3. 地铁管理 → 城市筛选切「杭州」→ 断言只剩杭州线路 → 点开抽屉改名保存 → 刷新后仍在，**且筛选未丢**。
4. 商圈管理 → 点「仅看缺边界」→ 断言结果集正确 → 打开一个商圈 → 断言「空间与展示」面板存在 → 填别名保存 → 刷新后仍在。
5. `Cmd+K` → 输「杭州2」→ 断言结果带城市面包屑 → 回车进入正确对象。

**注意（踩过的坑）**
- spec 里请求用的 BASE **绝不能**用 `NEXT_PUBLIC_SITE_URL`（CI 里那是线上地址），必须用 `PLAYWRIGHT_BASE_URL` 或 localhost。
- 本地跑用 `pnpm exec playwright test tests/e2e/geography-admin.spec.ts`，**不要**用 `pnpm test:e2e --` 过滤（不可靠）。
- 跑之前确认端口上的 server cwd 是本工作树，否则会复用别的 worktree 的陈旧 server 导致大面积假失败。

**最终验收清单**
- [ ] `pnpm test` 全绿；`pnpm build` 通过。
- [ ] `pnpm payload migrate` 从空库到最新完整跑通。
- [ ] 2 城样例数据下人工走完 A5 的两条路径，实测步数 ≤3 / ≤2。
- [ ] A6 度量表逐项核对并记录实测值。
- [ ] 每个 Task 一个独立 commit，提交信息用简体中文。

---

# 阶段五 · 七城数据导入（Task 18–22）

> **前置条件：Task 1–17 全部完成并验收通过。** 导入依赖 `city` 字段（Task 1–4）与四个模块页（Task 6–10）做人工抽检，提前跑没有意义。

## Task 18 · 区域代码命名规范 + 种子数据格式

**做什么**

1. 定稿 `immutableCode` 命名规范并写进 `docs/geography-code-convention.md`。必须满足既有正则 `^[A-Z0-9][A-Z0-9_-]{1,63}$`（`location-hierarchy.ts:102`），建议：

| 类型 | 格式 | 示例 |
|---|---|---|
| 城市 | `CITY-<拼音缩写>` | `CITY-SH`、`CITY-HZ`、`CITY-JX` |
| 行政区 | `<城市>-D-<行政区划代码后6位>` | `SH-D-310106` |
| 商圈 | `<城市>-BA-<拼音>` | `SH-BA-NANJINGXILU` |
| 地铁线路 | `<城市>-ML-<线路号>` | `HZ-ML-2`、`SH-ML-16` |
| 地铁站 | `<城市>-MS-<拼音>` | `HZ-MS-FENGQICHENGZHAN` |

   - 行政区**必须带国家统计局 6 位行政区划代码**，这是唯一权威主键，改名不影响。
   - 站点可能同名跨线（换乘站在本模型里挂唯一线路，**换乘站归属哪条线要在 Task 19 定口径**）。

2. 定稿种子文件 schema，新建 `payload-office-platform/seed/geography/schema.md` 与 `_template.json`：

```jsonc
{
  "city": { "name": "杭州市", "immutableCode": "CITY-HZ", "slug": "hangzhou",
            "centerLatitude": 30.2741, "centerLongitude": 120.1551, "sortOrder": 30 },
  "districts": [
    { "name": "上城区", "immutableCode": "HZ-D-330102", "slug": "hangzhou-shangcheng",
      "centerLatitude": 30.2, "centerLongitude": 120.2, "sortOrder": 10 }
  ],
  "businessAreas": [
    { "name": "武林广场", "immutableCode": "HZ-BA-WULINGUANGCHANG", "slug": "hangzhou-wulin",
      "districtCode": "HZ-D-330103", "centerLatitude": 30.27, "centerLongitude": 120.16, "sortOrder": 10 }
  ],
  "metroLines": [
    { "name": "地铁1号线", "immutableCode": "HZ-ML-1", "slug": "hangzhou-metro-1", "sortOrder": 1,
      "stations": [
        { "name": "湘湖", "immutableCode": "HZ-MS-XIANGHU", "slug": "hangzhou-metro-xianghu",
          "centerLatitude": 30.15, "centerLongitude": 120.25, "sortOrder": 1 }
      ] }
  ]
}
```

   - 引用一律用 `immutableCode` 而非 id（id 随环境变化，code 是稳定键）。
   - `slug` 全局唯一（`Locations.slug` 有 unique 约束），命名规范同样写进文档。

**验收**
- [ ] 规范文档已提交，含冲突处理规则（同名商圈、跨线同名站、行政区改名）。
- [ ] `_template.json` 可通过 Task 19 的校验器。

---

## Task 19 · 导入脚本（dry-run 优先）

**做什么**：新建 `payload-office-platform/scripts/import-geography.ts`

```bash
pnpm tsx scripts/import-geography.ts --file seed/geography/hangzhou.json --dry-run
pnpm tsx scripts/import-geography.ts --file seed/geography/hangzhou.json --apply
pnpm tsx scripts/import-geography.ts --all --dry-run
```

**行为**
1. **先校验后写**：解析 → 纯函数校验（code 格式、slug 唯一、层级引用可解析、坐标范围、文件内自查重）→ 任一失败**整文件拒绝**，不做部分导入。
2. **dry-run 是默认**，`--apply` 才真正写入。dry-run 输出：
   ```
   杭州市 CITY-HZ
     新建 13 行政区 / 42 商圈 / 12 地铁线路 / 248 地铁站
     跳过 0（已存在且内容一致）
     冲突 2（immutableCode 已存在但字段不同）：
       HZ-D-330102  name: 上城区 → 上城區
   ```
3. **幂等**：按 `immutableCode` 查已存在记录 —— 一致则跳过；不一致则**列出差异并默认跳过**，`--update-existing` 才更新。**绝不静默覆盖。**
4. 严格按 城市 → 行政区 → 商圈 / 线路 → 站点 顺序，逐条 `payload.create`（过 hook）。
5. 每条失败单独记录并继续，最后汇总失败清单与失败原因（`InvalidOperationError` 的 code + message），退出码非 0。
6. 全程日志写 `.tmp/geography-import-<city>-<timestamp>.log`。

**约束**
- 必须走 Local API，**不得直接写库、不得 `overrideAccess` 绕过 hook 之外的任何校验**。
- 脚本自身不联网。数据从种子文件来，采集是 Task 20 的人工/半自动工作。
- 校验逻辑抽成纯函数放 `src/domain/geography/import-validation.ts`，单测覆盖。

**验收**
- [ ] `tests/geography-import-validation.test.ts`：格式错、层级断链、文件内重复 code、坐标越界、slug 冲突，各有用例。
- [ ] 空库对 `_template.json` 跑 dry-run → apply → 再跑 dry-run，**第二次输出应为"全部跳过、0 新建"**（幂等验证）。
- [ ] 故意改一个字段后重跑，输出冲突清单且默认不覆盖。

---

## Task 20 · 七城种子数据准备

**做什么**：逐城产出 `seed/geography/{shanghai,nanjing,hangzhou,suzhou,wuxi,ningbo,jiaxing}.json`。

**分三类推进**

1. **行政区（可精确，先做）**：以民政部 / 国家统计局最新行政区划代码为准，含区、县级市、县。**核对截止日期写进文件头注释**（行政区划会调整）。
2. **地铁线路与站点**：以各地地铁集团官方线网图为准，逐线核对。三个必须先定的口径：
   - **换乘站归属首开线路**（已定稿，见 B1.5）：同名换乘站库中只存一条，`parent` = 首开线路；同期开通的按线路号小的归属。
   - **在建/未开通线路与站点不导入**（已定稿）。
   - **嘉兴是否有地铁**：核实嘉兴目前的轨道交通运营情况（可能只有市域铁路 / 有轨电车，不属本模型的 `metro_line`）。若无，嘉兴 `metroLines` 为空数组，这是合法的。
3. **商圈（需业务定口径，最后做）**：无权威源，见下方「待决策」。

**数据来源合规**：使用地图服务商 API 需遵守其配额与使用条款；不抓取竞品站点数据。采集方式在文件头注明来源与日期。

**验收**
- [ ] 七个文件全部通过 Task 19 的 dry-run 校验，零错误。
- [ ] 每个文件头有来源、采集日期、核对人。
- [ ] 站点总数与官方线网图逐线核对一致（在实施记录里登记每条线的站数）。

---

## Task 21 · 分城导入执行

**做什么**：按 **杭州 → 苏州 → 无锡 → 宁波 → 嘉兴 → 南京 → 上海** 顺序执行（数据量从小到大，先在小城暴露问题；上海最后，因为它是存量数据最可能已存在的城市）。

每城流程：
1. 本地独立库（`sbh_dev_geo`）dry-run → apply → 在四个模块页人工抽检（计数是否正确、层级是否正确、树是否正常）。
2. 类生产环境（本地 `next start` + PG）重跑一次，确认无环境差异。
3. **生产执行前先备份**，然后 dry-run，人工确认输出，再 `--apply`。
4. 导入后在城市管理模块核对完备度计数与种子文件条数一致。

**上海的特殊处理**：生产库可能已有上海的存量地理数据。上海导入前**必须先跑一次 dry-run 看冲突清单**，与现有数据逐条比对，决定是"跳过存量"还是"更新存量"——**不要直接 `--update-existing`**。

**验收**
- [ ] 七城全部导入完成，每城在城市管理模块的计数与种子文件一致。
- [ ] 生产库导入前后的 `locations` 总行数变化与预期一致。
- [ ] 无任何节点 `city_id` 为空（除城市节点自身）。
- [ ] 导入日志全部归档。

---

## Task 22 · 导入后验收与前台开关

**做什么**
1. **规模验收**：约 2000 节点下，四个模块页首屏 < 1s；城市详情页的只读树在上海（~650 节点）下可用；全局搜索响应 < 300ms。**这是对整个重构的真实压力测试。**
2. **数据质量抽检**：每城随机抽 5 个商圈、5 个站点，核对名称、层级、坐标。
3. **前台可见性**：所有导入节点 `frontendVisible = false`。由运营按业务节奏逐城、逐商圈开启，**本任务不批量开启**。
4. 确认 C 端未因新增数据出现异常（首页热门商圈、筛选项等仍只展示 `frontendVisible = true` 的节点）。

**验收**
- [ ] 性能指标实测并记录在实施记录。
- [ ] 抽检无错误。
- [ ] C 端页面无变化（因为默认不可见）——这是**正确**的结果，不是 bug。

---

## B1.5 · 阶段五口径（已定稿，不要重新讨论）

1. **商圈口径**：只导入**核心办公商圈**，不求全。配额按城市能级递减，作为软上限而非硬指标——宁缺毋滥：

   | 城市 | 商圈配额 |
   |---|---|
   | 上海 | 25–30 |
   | 南京、杭州 | 15–20 |
   | 苏州、宁波、无锡 | 10–15 |
   | 嘉兴 | 8–10 |

   判定标准：**该商圈有实际在售/在租的商办楼盘供给**。没有供给的商圈一律不导入——导进来只会让"缺边界商圈数"永远飘红、让列表变脏。后续按业务需要逐个补充。

2. **换乘站归属首开线路**。同名换乘站在库中**只存一条记录**，`parent` 为其首开线路；其他线路对该站的关系不在本期建模。首开时间相同的（同期开通换乘站）按线路号小的归属。

3. **在建/未开通线路与站点一律不导入**。开通后单独追加一次导入。

---

## B2. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 回填 SQL 列名/表名猜错 | 迁移报 42703 | B1.1 强制先核对生成迁移的 JSON |
| 存量孤儿节点（parent 断链） | 回填后 `city_id` 为空，新 hook 拒绝更新该节点 | Task 4 要求回填后跑校验 SQL 出清单人工修；`CITY_UNRESOLVED` 只在写入时抛，不影响读 |
| 自定义 admin 路由 API 与 3.86 实际类型不符 | Task 6 整体阻塞 | Task 6 要求先读 `node_modules/payload` 类型定义，不照抄旧版文档；若 3.86 不支持，退化方案是四个 `(payload)` 路由组下的自建页面 + 复用 Payload 认证 |
| 聚合 SQL 绕过 access control | 越权泄露 | 只返回聚合数字、不返回行级明细；文件头注释写明边界；`buildings` 计数照搬既有可见性条件 |
| 计算列不能排序，运营不满 | 体验回退 | A2 已明确接受；真有需求再上反范式计数列（独立任务） |
| 删 menu code | 存量角色数据非法 | Task 15 明确禁止增删 code，只复用既有两个 |
| 内嵌面板绕过写侧校验 | 不变量失守 | 面板走标准 REST，hook 原样保留；Task 11 验收含"强行提交仍被拒" |
| 树下线后层级不可见 | 开城校对困难 | Task 7 的城市详情页只读树为**必做项，不可裁剪** |
| 导入脚本静默覆盖存量数据 | 生产数据被改写且无迹可循 | Task 19 强制 dry-run 默认、冲突默认跳过、`--update-existing` 显式开启；上海导入前必须逐条比对 |
| 换乘站归属口径未定就开始采集 | ~500 站返工 | B1.5 列为 Task 20 的阻塞性前置决策 |
| 行政区划调整（撤县设区等） | 代码与名称不一致 | 行政区代码用统计局 6 位码，改名不影响主键；文件头记录核对日期 |
| 导入后节点默认可见 | 未审核数据直接上 C 端 | 全部导入 `frontendVisible = false`，Task 22 明确不批量开启 |

**回滚**：阶段一（Task 1–5，数据基座）与阶段二/三（UI）解耦。UI 出问题可单独 revert 前端 commit，`city` 字段留着无副作用（只读、可空）。字段本身回滚走迁移 `down`。

---

# Part C · 交付质量守则（实现者必读）

> 本节不是建议，是**验收门槛**。违反红线的提交一律回退重做，不做补丁式修补。

## C1. 十条红线（违反即回退）

1. **不手改 `pnpm payload migrate:create` 生成的迁移文件正文。** 需要额外 SQL 就新建一个迁移文件。
2. **不在数据迁移里调 `payload.update` / `payload.create`。** 会触发文档锁检查导致生产 42703。回填只走原生 SQL。
3. **不直接写库绕过 hook。** 所有写入走 Local API 或 REST，让 `protectLocation` / `protectBusinessAreaExtension` 生效。导入脚本尤其。
4. **不改任何既有错误码与错误文案。** 前端与 E2E 依赖它们。新增场景用新错误码。
5. **不删 / 不改 `MENU_CODES` 的既有成员。** 已写进生产角色数据。
6. **不在循环里发查询。** 本计划所有计数与批量校验都要求单次聚合或 `in` 查询。写出 `for (...) { await payload.findByID(...) }` 视为缺陷。
7. **不用 `as any` / `@ts-ignore` 绕类型。** 类型不通说明理解有偏差，去读类型定义。
8. **不用 `catch {}` 静默吞错。** 现有 `loadNode` 的 `catch { return null }` 是历史写法，**不要模仿扩散**。新代码 catch 必须要么处理、要么带上下文重抛、要么记日志。
9. **不改测试去迁就实现。** 测试红了先假设实现错。确需改测试，在 commit 信息里说明为什么原断言是错的。
10. **不用 `git add -A` / `git add .` / `git commit -am`。** 只用显式路径。`payload-office-platform/public/prd/*.md` 处于已删除状态，是有意搁置的，别恢复别提交。

## C2. 每个 commit 的机械门禁

以下四条**必须实际执行并贴出真实输出**，不允许"应该没问题"：

```bash
pnpm test                    # Vitest 全量，必须全绿
pnpm build                   # 含类型检查，必须通过
pnpm payload migrate         # 有 schema 变更时，本地独立库跑通
git diff --stat HEAD         # 确认改动范围与 Task 描述一致，无越界文件
```

**"我认为可以了"不构成完成。** 没有命令输出的完成声明视为未完成。

## C3. 动手前的三个强制动作

1. **先读完整文件再改。** 不要基于片段猜上下文。本仓库很多约束写在文件头注释里（如 `BusinessAreaExtensions.ts` 开头解释了为什么分表、`location-references.ts` 解释了引用口径），改之前必须读。
2. **API 形状去 `node_modules` 查，不要凭记忆。** Payload 3.86 与网上多数教程（2.x / 3.0 早期）不兼容。自定义 admin 视图、drizzle 实例、endpoint 签名，全部以 `node_modules/payload` 的类型定义为准。**幻觉一个不存在的 API 是本项目最高频的失败模式。**
3. **列名、表名去生成的迁移 JSON 查。** 见 B1.1。凭记忆写 `city_id` 而实际是别的，会在生产炸 42703。

## C4. 不确定时的处理

**遇到以下情况停下来问，不要猜着往下做：**

- 计划里没写、但实现时发现必须做的决策（尤其涉及数据模型、错误语义、生产数据）。
- 计划的某一步与代码现状矛盾（说明计划写错了——**这时要改计划文件并说明**，不要默默绕过）。
- 需要新增依赖包。
- 需要改动本计划范围外的文件。

猜错一次的返工成本，远高于问一次的沟通成本。**本计划已经在阶段一发现过"计划自身缺陷"的先例**（见仓库里 `2026-08-09-entrust-supply-pages.md` 的执行记录），发现即修正即回写，是正常流程。

## C5. 范围纪律

- **一个 Task 一个 commit**，commit 信息用简体中文，格式 `feat(geography): Task N 简述`。
- **不做计划外的"顺手优化"。** 看到别处代码不顺眼，记下来单独提，不要塞进本次改动。混在一起会让 review 失效。
- **不预先抽象。** 四个模块共享组件是计划里写明的（Task 6），除此之外不要为"将来可能有第五个模块"做额外抽象层。
- **删代码要彻底。** Task 16 下线旧树视图时，不要留 `// 暂时保留` 的死代码。

## C6. 阶段性 review 检查点

每个阶段结束、进入下一阶段前，跑一次代码 review（本仓库有 `/review` skill），重点看：

| 阶段 | review 重点 |
|---|---|
| 一（Task 1–5） | `city` 语义是否在所有写路径都维护到；聚合 SQL 是否有注入风险（参数化）、是否漏了软删除条件 |
| 二（Task 6–10） | 四个模块是否真的共享同一套组件而非复制四份；URL 状态是否完整；权限是否被自定义路由绕过 |
| 三（Task 11–14） | 内嵌面板是否绕过了任何写侧不变量；乐观锁是否真的生效（并发测试） |
| 四（Task 15–17） | 死代码是否清干净；menu code 是否动过 |
| 五（Task 18–22） | 导入脚本的幂等性；dry-run 与 apply 行为是否一致；生产执行前的备份 |

## C7. 完成度的定义

一个 Task 只有同时满足下面全部才算完成：

- [ ] 该 Task 的验收清单**逐条勾选**，每条有对应证据（命令输出 / 截图 / 测试名）。
- [ ] C2 的四条门禁全绿。
- [ ] 新增逻辑有测试；纯函数走 TDD（先红后绿）。
- [ ] 本文件的「实施记录」已回填。
- [ ] 已 commit 且 push（**每天至少推一次 WIP**，防本地黑洞）。

**部分完成要如实说明**：哪几条验收没过、为什么、阻塞在哪。**不要把"跳过了"说成"完成了"**——下游会基于错误的完成状态继续开发，代价成倍放大。

---

## B3. 实施记录（实现者填写）

| 项 | 值 |
|---|---|
| `city` 字段实际列名 | `city_id`（integer, nullable）；索引 `locations_city_idx`；外键 `locations_city_id_locations_id_fk` ON DELETE set null（迁移 `20260810_114857_locations_city_field`） |
| `parent` 实际列名 | `parent_id`（integer, nullable） |
| `metroStations` 关系中间表名 | `business_area_extensions_rels`（`parent_id`=扩展记录 id, `locations_id`=站点 id, `order`=排序） |
| Payload 3.86 自定义 admin 视图注册方式 | `admin.components.views = { <键>: { Component, path } }`（`path` 以 `/` 开头，`exact` 缺省按前缀匹配）。⚠️ 3.86 的 `isCustomAdminView`（`@payloadcms/next`）把**所有**自定义视图当公共路由、跳过 `/admin` 登录重定向（`AdminViewConfig` 类型无 `public` 字段），未登录可直接访问并读到数据。必须在自定义视图 server 组件顶层自检 `initPageResult.req.user`，为空则 `redirect()` 到 `${admin.routes.login}?redirect=<当前路由>`（本计划在共享 `GeographyListView.tsx` 补一处，四路由共用） |
| Payload 3.86 原生创建页预填 | **不支持从 query params 预填**。`Document/renderDocument` 在 create（无 id）时 `initialData:null`，`@payloadcms/next/views/Root` 不读 `?field=` 到初始表单态。Task 8 起「新建」改走轻量自定义视图 `/geography/<route>/new`（Server 解析模块+预填父级，Client 提交 REST 过 hook）——Task 9/10 复用同一套，别再用 query 预填原生创建页 |
| `buildings` 可见性/软删除条件 | `trash: true`，软删除列 `deleted_at`（过滤 `deleted_at IS NULL`）；地理关系列 `city_id`/`district_id`/`business_district_id`/`nearest_metro_id` |

| 换乘站归属口径 | 待定（B1.5） |
| 商圈口径 | 待定（B1.5） |
| 嘉兴轨道交通核实结论 | 待填 |

| Task | 状态 | commit / 备注 |
|---|---|---|
| 1 `locations.city` 反范式字段 | ✅ 完成 | `feat(geography): Task 1 locations.city 反范式字段`；列名 `city_id` 已核对，计数守卫测试 40→41 |
| 2 城市解析纯函数 + 查询辅助 | ✅ 完成 | `feat(geography): Task 2 城市解析纯函数与查询辅助`；TDD 13 用例全绿 |
| 3 写侧维护 `city` + 同城校验常数级 | ✅ 完成 | `feat(geography): Task 3 写侧维护 city 与同城校验`；`resolveCityId` O(1) 读 city 字段；`CITY_UNRESOLVED` 防孤儿节点；站点批量 `find({id:{in}})` 一次查询；全仓 2602 用例绿 |
| 4 存量数据回填迁移 | ✅ 完成 | `feat(geography): Task 4 存量数据回填迁移`；手写 `20260810_200000_backfill_location_city`（递归 CTE 纯 UPDATE）；灌 2 城×5 类型样例后 `type<>'city' AND city_id IS NULL` = 0；up→down→up 往返验证通过。注：`parent_id` FK 在库层阻止断链父级，真孤儿无法落库，孤儿分支为防御性 |
| 5 聚合计数服务 | ✅ 完成 | `feat(geography): Task 5 聚合计数服务`；`location-counts.ts` 原生 SQL 经 `payload.db.drizzle` 执行；每函数固定 1~2 条 SQL（`ANY($ids::int[])` 单参数绑定，ids 空直接空 Map）；商圈站点/线路走 `business_area_extensions_rels`；缺边界=无扩展或 boundary NULL/空；楼盘计数照搬 public-building 可见性；`drizzle-orm@0.45.2` 加为直接依赖（与 db-postgres 同版）；单测 8 例 + `verify:location-counts` 2 城 9 断言全过 |
| 6 自定义 admin 路由骨架 + 共享列表组件 | ✅ 完成 | `feat(geography): Task 6 自定义 admin 路由骨架与共享列表组件`；四视图注册 `admin.components.views`（键+`path`，3.86 类型为准）；共享 `GeographyListView.tsx`(server)+`GeographyListViewClient.tsx`(client)+`geography-modules.ts`(模块注册)，四模块同一套组件非复制；筛选/分页全进 URL；抽屉 PATCH 带 `version` 乐观锁、冲突展示 `VersionConflictError` 文案；计算列 `sortable:false`。两个修复：`payload-after-error.ts` afterError 钩把 `DomainError` 映射回状态码（否则 `VersionConflictError` 被 500 兜底吞掉）；`ArcoReact19Provider`(`setCreateRoot`) 修 React 19 下 Arco `Message.success` 静默不渲染。C2 门禁：`pnpm test` 2610 绿、`pnpm build` 过、无 schema 变更（免 migrate）、`git diff --stat` 范围达标。期间发现并修复**匿名访问泄漏**——3.86 自定义视图无认证门槛，共享组件顶层补 `req.user` 判定 + `redirect()`（见 B3 视图注册行） |
| 5–17 开发 | 进行中（Task 8 完，接 Task 9） | |
| 18–22 导入 | 待开始（依赖 1–17 完成） | |
| 9 商圈管理模块（边界/封面列 + 快捷 chip） | ✅ 完成 | `feat(geography): Task 9 商圈管理模块`；沿用共享列表，`geography-modules.ts` 加 `chips` 配置 + `GeographyColumn` 增 `flag` 列型（✓/⚠），`BUSINESS_AREA_COLUMNS` 至 11 列（插 边界/封面 两 flag 列，紧邻关联线路数后、状态列前）。边界列数据/「仅看缺边界」chip 走 `business-area-extensions` 表：`location-counts.ts` 新增 `fetchBusinessAreaBoundaryStatus`(本页 Map<id,hasBoundary>) + `fetchBusinessAreaMissingBoundaryIds`(全范围缺边界 id 集合，`id:{in}` 并入 where 实现分页前过滤，口径=无扩展或 boundary NULL/空)；「仅看缺封面」chip 用原生 `coverImage:{exists:false}`。chip 多选以 URL `chip=a,b` 表达、切 chip 回第一页，非法 key 丢弃。行政区随城市联动（切城重置 parent）Task 6 已就绪。单测 9 例（flag 列/11 列序/chips 配置 + `shapeBoundaryStatus`）。C2 门禁：`pnpm test` 2624 绿、`pnpm build` 过、无 schema 变更（免 migrate）；新增 `scripts/verify-business-area-boundary.ts`（`pnpm verify:business-area-boundary`）真实库验证：钱江=有边界/金鸡=缺边界、缺边界集合按城过滤与 Task 5 `businessAreasMissingBoundary` 逐城一致、关联线路数沿用去重 `COUNT(DISTINCT parent_id)`；HTTP 验收：登录后 `/admin/geography/business-areas` 渲染 11 列 + 两 chip，`?chip=missingBoundary` 只留金鸡湖（钱江被滤）、`?chip=missingCover` 缺封面者俱现 |
| 8 行政区模块（新建预填） | ✅ 完成 | `feat(geography): Task 8 行政区管理模块与新建视图`；行政区列表沿用 Task 6 共享组件（列/城市筛选/`countForDistricts` 计数已就绪）。重点打通「新建」：**发现 Payload 3.86 原生创建页不从 query params 预填**（`renderDocument` create 时 `initialData:null`，Root 视图不读 `?type=/parent=`）→ 用户拍板弃用「跳原生页预填」，改**轻量自定义新建视图** `GeographyCreateView`(server)+`GeographyCreateViewClient`(client)，注册 `/geography/districts/new`；`geography-modules.ts` 加 `create` 配置（type/parentFilter/parentTargetType/label）+ `getGeographyModuleByCreatePath`；列表头部按模块 create 配置渲染「新建」按钮，携带当前城市筛选跳 `/new?city=<id>` 预填 parent；表单提交 REST `/api/locations` 过 `protectLocation` hook → city 自动填对。单测 7 例（新增 create 配置 + 路径解析）。C2 门禁：`pnpm test` 2621 绿、`pnpm build` 过、无 schema 变更；浏览器验收：城市筛选预填 parent=上海、创建后跳编辑页 2014、`city` 自动写 2006、楼盘数与 `buildings.district` 一致（长宁=1）、匿名访问 `/new` 跳登录 |
| 7 城市管理模块（详情页 + 只读层级树） | ✅ 完成 | `feat(geography): Task 7 城市管理模块`；新建 `/geography/cities/:id`，`GeographyCityDetail.tsx`(server)+`GeographyCityDetailClient.tsx`(client)；`location-tree.ts` 新增 `CITY_CHILD_GROUP_ORDER` + `groupCityDirectChildren`（DIRECT 子节点按类型分组，仅 district/metro_line 两个合法直接子类型，空的类型组不渲染，顺序固定 district→metro_line），TDD 4 用例；只读树默认展开一层（城市 + 各类型分组节点），无编辑/新建按钮，节点点击跳对应模块 `?q=<immutableCode>` 定位。三个修复：①`toFlatLocationNode` 只认对象 parent，`depth:0` 时关系字段回退为裸 number 导致 `parentId` 全 null、树只剩孤根——补 number 分支；②Arco Tree `selectedKeys` 是字符串 key，`byId` 却按 number 建索引，点击节点查不到而不跳转——统一字符串索引；③`findByID` 对不存在 id 抛 NotFound→500，改 `find(limit:1)` 过滤 type=city 一次查询，不存在/非城市走空态。C2 门禁：`pnpm test` 2619 绿、`pnpm build` 过、无 schema 变更（免 migrate）；浏览器验收上海完备度卡（行政区 5/缺边界 2 高亮/楼盘 6）、只读树分组与点击跳转、苏州/杭州 2 城、无效 id 空态、匿名登录重定向 |

**七城导入登记**（Task 21 逐城填写）

| 城市 | 行政区 | 商圈 | 线路 | 站点 | dry-run 日期 | 生产执行日期 |
|---|---|---|---|---|---|---|
| 杭州 | | | | | | |
| 苏州 | | | | | | |
| 无锡 | | | | | | |
| 宁波 | | | | | | |
| 嘉兴 | | | | | | |
| 南京 | | | | | | |
| 上海 | | | | | | |
