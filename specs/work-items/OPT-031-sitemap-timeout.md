# Task Packet：OPT-031 /sitemap.xml 线上 100% 超时

> 状态：**部分完成**（PR #65 已上线，从 100% 不可用变为可用；自定的 5 秒线未达标，剩余项见 §7）
> 创建日期：2026-08-18
> 发现方式：出售频道上线后例行验收线上路由，`/sitemap.xml` 无响应；后续实测确认与出售功能无关

## 1. 现象

生产环境（`sbh-095` / commit `1874274`）实测：

| 路由 | 结果 |
|---|---|
| `/sitemap.xml` | **HTTP 000，70 秒无响应**（curl `--max-time 70` 超时） |
| `/robots.txt` | HTTP 200，0.08s |
| `/`、`/shanghai`、`/shanghai/listings`、`/admin` | HTTP 200，均 < 0.15s |

不是偶发慢，是**稳定 100% 失败**。搜索引擎目前抓不到站点地图。

## 2. 已排除的两个猜测

排查时先怀疑的两条都不成立，记在这里避免下一个人重走：

1. **不是构建期预渲染问题。** `src/app/(frontend)/sitemap.ts` 第 22 行已有 `export const dynamic = 'force-dynamic'`。
   （CloudRun 构建日志里确实有 `cannot connect to Postgres. connect ECONNREFUSED 127.0.0.1:5432`，
   但那是**另一处**在构建期连库，与 sitemap 无关，见 §6 遗留问题。）

2. **不是分页循环反复查库。** `getCityListings` 的 `while` 循环看着可疑，但 `getCachedSearchListings`
   是先构建一次 search source（昂贵）再**内存分页**，且 `buildListingSearchSourceCacheKey` 把
   `page` 归一到 1（`cached-queries.ts:247`），传给 `unstable_cache` 的参数也归一了。所以缓存键
   跨页稳定，循环第二页起就命中缓存。

## 3. 根因

成本集中在**每个城市构建一次全量 search source**：`buildListingSearchSource` →
`adapter.findEffectiveListings` 拉全量有效供给，再对**每一套房源**逐条精筛（媒体数 ≥3、商户关系
有效期、商户资质、举报暂停），最后生成完整的 `ListingCardViewModel`（格式化价格、媒体、标签）。

sitemap 只需要 URL 和 `lastModified`，却付了整套搜索结果卡片的钱。当前生产有 2213 套房源、7 个
可服务城市，累加超过请求超时。

**并且这是个死循环**：请求超时 → `unstable_cache` 的结果永远写不进去 → 下一次请求仍然是冷的 →
再超时。所以它表现为 100% 坏而不是偶尔慢。代码里已有注释记录过这个循环
（`sitemap.ts` 第 44 行），但当时只减少了查询**次数**（一次拉全集、内存分租售），没有降低**单次成本**。

## 4. 方案（两条都需要，缺一不可）

### 4.1 给房源补专用的轻量 sitemap 查询

楼盘早就有 `getCachedSitemapBuildingsPage`（`cached-queries.ts:207`，每页 200，走
`searchBuildingsPage` 而非搜索管线）。房源没有对应物，仍在走 `getCachedSearchListings`。

补一个 `getCachedSitemapListingsPage`：只 select 生成 URL 与 `lastModified` 所需字段，跳过
view model 映射。

**待解决的难点**：精筛（媒体数、商户关系、资质）目前是取出候选后在应用层逐条做的。sitemap 若跳过
精筛会输出一批实际不可见的 URL（详情页大概率 404），对 SEO 是另一种伤害。两个方向：

- **(a)** 把精筛下推到 SQL（媒体数用 `COUNT` 子查询、商户关系用 join + 有效期条件）。
  仓库里已有 raw SQL 的先例：`supply-adapter.ts` 的在租面积聚合。**推荐这条**。
- **(b)** 接受 sitemap 与详情页可见性的短暂不一致，只做查询层过滤。成本低但引入正确性债。

### 4.2 按城市拆成 sitemap index

用 Next 的 `generateSitemaps` 把 `/sitemap.xml` 拆成每城一个子 sitemap。单次请求只处理一个城市，
各自独立缓存、独立失效。

单靠这条不够——上海占了绝大多数房源，单城仍可能超时——所以必须和 4.1 一起做。

## 5. 验收标准

1. 生产 `/sitemap.xml` **冷缓存**下 5 秒内返回 200（当前是 70 秒无响应）
2. 子 sitemap 逐个可达，且条目数与各城有效供给数一致
3. sitemap 输出的房源 URL **逐条可达**（抽样 ≥50 条，不得有 404）——这是 4.1 选 (a) 还是 (b) 的判据
4. 连续两次请求，第二次明显更快（证明 `unstable_cache` 真的写进去了，死循环解开）
5. 出售频道开关关闭时，sitemap 不含任何 `/sale` 条目（已有 `sale-channel-gating` 测试覆盖，别回退）

## 7. 实施结果（PR #65，线上实测 commit `3e5b200`）

只做了 §4.1，且选了 (a) 的简化形态——没有把精筛下推 SQL，而是**减少取出来的数据量**：
新增 `findEffectiveListingsSitemapPage`（`depth: 1` + `select` 五个字段），精筛仍走同一个
`fineFilter`。§4.2 的按城市拆分**未做**。

### 实测对照

| 验收标准 | 结果 |
|---|---|
| 冷缓存 5 秒内返回 200 | ⚠️ **7.24 秒**，返回 200 但未达标 |
| 第二次请求明显更快（证明 unstable_cache 写进去了） | ✅ **0.196 秒**——死循环解开 |
| 输出的房源 URL 逐条可达（抽样 ≥50） | ✅ 均匀抽 50 条，**50/50 全 200**，零死链 |
| 开关关闭时不含 `/sale` 条目 | ✅ 0 条 |
| 子 sitemap 逐个可达 | — 未拆分，不适用 |

改动前：`HTTP 000`，70 秒无响应，100% 不可用。
改动后：`HTTP 200`，568 KB，2305 条 URL（2125 房源 + 72 楼盘 + 100 资讯 + 1 页面 + 静态）。
`lastmod` 有 2141 个不同值（真实 updatedAt，不再统一填 now）。

### 为什么暂缓拆分（§4.2）

7 个城市是并发的，所以 7.24 秒基本等于**最慢那个城市（上海）的单城成本**。拆成 sitemap
index 后上海那个子 sitemap 仍然约 7 秒，收益主要在「其余六城各自更快、可分别抓取」这个
边角上。

而热缓存 0.196 秒意味着 5 分钟 revalidate 窗口内只有第一次付 7 秒，绝大多数抓取命中缓存。
所以判断是：**先不拆**，等有证据表明 7 秒真的造成抓取问题再说。

### 更值钱的后续（建议独立工作项）

上海单城 7 秒说明 `fineFilter` 处理 2000+ 条房源本身就重。而**城市房源列表页走的是更重的
同一段逻辑**——还要拼完整展示卡片，实测 `/shanghai/listings` 冷启动 5.2 秒。把精筛真正下推
到 SQL（§4.1 的 (a) 完整形态，可照 `sumEffectiveLeasableAreaByBuildings` 与
`scripts/verify-leasable-area-parity.ts` 的既有先例）会同时压掉这两处——那是**真实用户在
等**的地方，不只是爬虫。

## 6. 顺带记录的遗留问题（不属于本工作项）

CloudRun 构建日志（`sbh-096`）在 "Collecting page data" 阶段出现：

```
ERROR: cannot connect to Postgres. Details: connect ECONNREFUSED 127.0.0.1:5432
```

宪章明令 C 端读库页面一律 `force-dynamic`、禁止构建期连库。已确认**不是** sitemap（它已 force-dynamic），
出处未查明。该错误当前不致命（构建继续走到了镜像推送），但说明有页面在构建期尝试连库，值得单独排查。
