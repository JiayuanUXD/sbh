# OPT-122 查询条数证据

- 日期：2026-10-20（验收补测）
- 环境：dev server（`next dev -p 3721`）+ `sbh_dev_opt122`；插桩方式：monkey-patch `pg.Client.prototype.query` 计数，复刻路由 `/[city]/search` 的完整取数链路（非缓存函数直调）。

## 冷路径（缓存未命中，q=外滩源）

**16 条 SQL**：

| # | 查询 | 归属 |
|---|---|---|
| 1 | 词表（城市 + 行政区/商圈 + 地铁 + 楼盘） | `getCachedSearchVocabulary` |
| 2 | 房源选页（`buildListingPageQuery`，含 match_score 排序） | 房源 tab |
| 3–8 | 卡片水合（listing_reports ×2、distinct listings、listings 主查询、locations、merchants） | `hydrateListingCards` |
| 9–13 | 楼盘分页（locations ×2、merchants、stock 聚合、buildings 主查询） | `searchBuildingsFiltered` |
| 14–16 | 资讯计数 + 列表 + locations | `listPublishedArticles` |

其中 5 个顶层步骤全部位于 `unstable_cache`（300s + tag 失效）之内。

## 热路径（同关键词二次请求）

- 架构上：5 个步骤全部命中 `unstable_cache`，**0 条 SQL**（`coalesceInFlight` 合并并发）。
- HTTP 计时佐证（dev server，含编译噪声）：

| 请求 | 耗时 |
|---|---|
| 冷（首次关键词） | 0.629s |
| 冷后第二次（已缓存） | 0.137s |
| 热（第三次） | 0.132s |
| 热（第四次） | 0.142s |
| 零结果页（新词，触发兜底三条） | 0.203s |

## 备注

- 零结果页额外触发 `getCachedSearchFallback`（facet + 楼盘 + 房源三条查询，同样走 300s 缓存），按城市缓存、与 q 无关，因此零结果页之间可互相命中。
- `all` 与 tab 页的取数差异只在 `page`：tab 页对当前类型传真实页码，其余两类固定第 1 页（用于计数），五步查询数不变。
- 联想接口 `/[city]/search/suggestions` 只读已缓存的词表，**0 条 SQL**（内存过滤）。
- 测量脚本为一次性临时脚本，已删除；复刻方式见本文档表格，可按同样插桩法重跑。
