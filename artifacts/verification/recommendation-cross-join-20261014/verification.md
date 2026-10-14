# 详情页推荐候选 SQL 交叉连接（连接池占满）— 2026-10-14

## 现象

- 部署 run 238（`14c9316`，版本 sbh-229）冒烟失败回滚：50 次 `/api/health` 全打到稳定版本 sbh-227，
  约一半 HTTP 503（每次约 10s），`GET /` 两次 404。
- 指纹与 `DEPLOYMENT.md`「连接池被占满」一致。

## 生产库取证（CloudBase MCP `queryPgDatabase`，只读）

2026-10-14 10:47（UTC+8）`pg_stat_activity`，`usename = 'sbh'`：

| 状态 | 条数 | 说明 |
| --- | --- | --- |
| active | 6 | 同一 `query_id`（-6708605550801946392），已跑 6~25 分钟，`wait_event` 为空（纯 CPU，不是锁） |
| idle | 3 | |

查询文本（截断于 1KB）开头为 `SELECT l.id, COALESCE(l.listing_type::text, '') AS listing_type, …`，
对应 `buildRecommendationCandidatesQuery`（详情页推荐候选）。sbh-227 没有语句超时，连接被一直占住。

## 根因：执行计划

数据量：`listings` 约 5.7 万，`buildings` 4447，`locations` 1680（其中 active 1536），上海 202 个商圈。

旧 SQL 把 `AND b.business_district_id = $5` 拼在整城 `effectiveSupplySqlFrom()` 之后。对不在统计信息高频值里的商圈
（例 `business_district_id = 144`，12 栋楼），`EXPLAIN` 给出：

```
Merge Join  (Merge Cond: city.id = b.city_id; Join Filter: b.id = l.building_id AND dist.id = b.district_id)
  ->  Nested Loop                                  -- 无连接条件：房源 × locations dist
        ->  Nested Loop Anti Join  (rows=1 估算；实际为全城有效房源)
              ...  Index Scan using listings_merchant_idx on listings l
        ->  Seq Scan on locations dist  (rows=1536)
  ->  Sort -> Bitmap Heap Scan on buildings b (business_district_id = 144, rows=12)
```

商户 / 服务城市 / 城市几组相关谓词的选择率被连乘，房源被估成 1 行（`ANALYZE` 后仍估 36 行），
规划器于是把 `locations dist` 无条件交叉连进来、最后才按楼盘过滤：约 5.6 万 × 1536 × 12 次比较。
热门商圈（如 `= 10`）在高频值里，计划正常，所以只有部分详情页触发。

已尝试：`ANALYZE merchants, merchants_rels, listing_reports`（三表此前从未分析过；已执行，统计信息现为真实值），
**计划未改善**，确认不是缺统计信息，而是 SQL 结构问题。

## 修复

`buildRecommendationCandidatesQuery` 改为先在 `WITH scoped AS MATERIALIZED (…)` 里圈出范围内的合格楼盘
（楼盘 / 城市 / 行政区资格只在这里与 `buildings` 按外键相连），主查询 `FROM scoped b JOIN listings l …`
只剩房源侧谓词。资格谓词拆成 `EFFECTIVE_BUILDING_*` 与 `EFFECTIVE_LISTING_WHERE` 两段，
`effectiveSupplySqlFrom` 由同一份片段拼成，整城查询语义不变。

新 SQL 在生产库实测（只读，`clock_timestamp() - statement_timestamp()` 计时）：

| 范围 | 行数 | 耗时 |
| --- | --- | --- |
| 商圈 144（旧 SQL 触发交叉连接） | 13 | 1.7 ms |
| 商圈 10（最大商圈） | 1000（LIMIT） | 92 ms |
| 行政区 7（最大行政区） | 1000（LIMIT） | 186 ms |

新计划：`CTE Scan on scoped` → `Index Scan using listings_public_building_idx (building_id = b.id)`
→ `Memoize + merchants_pkey`；`locations` 只出现在 CTE 内。

## 测试

- `tests/recommendation-candidates-sql.test.ts`（新增）：锁住「locations 只在 CTE 内」与参数全被引用；
  在旧代码上 4 条失败，新代码全部通过。
- `tests/listing-query-postgres.test.ts` + `tests/building-query-postgres.test.ts`：本地临时 PostgreSQL 16 上
  198 条全过（推荐三档范围、整城目录与分面语义逐项一致）。临时库量完已删除。
- `pnpm typecheck`、`pnpm lint`（0 error）、`pnpm test`（441 文件 / 5994 条）全过。

## 未验证

- 容器网络策略拦截 `shangban.cc` 与 CloudRun 默认域名，本会话无法在浏览器里打开线上详情页；
  上线后的页面验证需借助部署流水线的冒烟 / 全量后验证，或由人工打开详情页确认推荐区出现。
