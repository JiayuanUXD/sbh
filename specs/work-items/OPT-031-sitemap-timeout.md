# Task Packet：OPT-031 /sitemap.xml 线上 100% 超时

> 状态：待实施（根因已定位，方案已定，未开工）
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

## 6. 顺带记录的遗留问题（不属于本工作项）

CloudRun 构建日志（`sbh-096`）在 "Collecting page data" 阶段出现：

```
ERROR: cannot connect to Postgres. Details: connect ECONNREFUSED 127.0.0.1:5432
```

宪章明令 C 端读库页面一律 `force-dynamic`、禁止构建期连库。已确认**不是** sitemap（它已 force-dynamic），
出处未查明。该错误当前不致命（构建继续走到了镜像推送），但说明有页面在构建期尝试连库，值得单独排查。
