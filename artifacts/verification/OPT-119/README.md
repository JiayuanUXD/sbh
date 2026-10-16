# OPT-119 验证证据：区域 / 商圈落地页

环境：本机隔离库 `sbh_dev_area_landing`（由 `sbh_dev_seo_content` 复制）+ `next dev -p 3737`，`MULTI_CITY_ROUTING_ENABLED=true`。
为让页面达标，向该库克隆了 30 套「陆家嘴」、14 套「南京西路」的日单价房源（**只是本地夹具，不进仓库**）；浦东 / 静安 / 陆家嘴 / 南京西路达标，徐汇 / 黄浦 / 长宁只有 1~2 套，用来验薄页。

## 静态闸门

| 项 | 结果 |
|---|---|
| `pnpm typecheck`（`tsc --noEmit`） | 干净 |
| `pnpm lint` | 0 error（37 条 warning 均为既有） |
| `pnpm test` | 470 文件 / 6438 用例全绿 |
| `tests/area-landing-postgres.test.ts`（真库，`DATABASE_URL` 指本地） | 4 用例全绿；CI `postgres-migrations` 作业以 `tests/*-postgres.test.ts` 通配自动带上 |
| `pnpm build` | 通过，`/[city]/area/[slug]` 为 ƒ（动态） |
| 变异验证 | ① 去掉 `FILTER (WHERE is_day_price)` → 真库用例红；② 让不可见商圈进索引 → facade 用例红；③ canonical 合并不看收录门槛 → canonical 用例红。三处均已还原 |

## HTTP 实测（`curl`）

| URL | 状态 | robots | 说明 |
|---|---|---|---|
| `/shanghai/area/pudong`（行政区，达标） | 200 | `index, follow` | title `浦东新区写字楼出租 · 办公室租金与热门楼盘 · 商办租赁`，canonical 自指，1 个 H1 |
| `/shanghai/area/lujiazui`（商圈，达标） | 200 | `index, follow` | |
| `/shanghai/area/xuhui`（本地仅 1 套） | 200 | `noindex, follow` | 薄页：渲染诚实空态，不进 sitemap |
| `/shanghai/area/nope`、`/shanghai/area/shanghai`（城市 slug）、`/hangzhou/area/xuhui`、`/area/xuhui` | 404 | noindex | |
| `/shanghai/area/%E0%A4%A`（畸形百分号编码） | 400 | — | Next 框架层拒绝 |

JSON-LD（浏览器内 `JSON.parse` 取出）：`BreadcrumbList`（首页 → 上海 → 浦东新区）+ `ItemList`（热门楼盘），所有 URL 绝对。控制台无报错；375 宽 `scrollWidth == innerWidth`，无横向溢出。

### 与列表数一致（同一有效供给口径）

| 落地页 | 落地页「在租房源」 | 筛选页 `共 N 套` |
|---|---|---|
| 浦东新区 | 32 | `/shanghai/listings?district=pudong` → 32 |
| 陆家嘴 | 32 | `/shanghai/listings?businessArea=lujiazui` → 32，楼盘页 `共 1 个楼盘` |

### 筛选页 canonical 合并

| 筛选页 | canonical |
|---|---|
| `/shanghai/listings?district=jingan` | → `/shanghai/area/jingan` |
| `/shanghai/buildings?district=jingan` | → `/shanghai/area/jingan` |
| `/shanghai/listings?businessArea=nanjing-west-road` | → `/shanghai/area/nanjing-west-road` |
| `/shanghai/listings?district=jingan&type=coworking` | 自 canonical（叠加了条件） |
| `/shanghai/listings?district=xuhui`（薄页） | 自 canonical |
| `/shanghai/listings` | 自 canonical |

### sitemap（`/sitemaps/static.xml`）

含 `jingan` / `pudong`（行政区，priority 0.8）与 `nanjing-west-road` / `lujiazui`（商圈，0.7）；`lastmod` 是该区域有效房源的真实最近更新时间（如 `2026-10-16T02:54:31.191Z`），不是请求时刻；薄页（xuhui / huangpu / changning）不在其中。

### 入口链接

- 首页热门商圈卡 / Hero chips（点击实测 陆家嘴卡 → `/shanghai/area/lujiazui`）。**线上原链接是 `?district=<商圈slug>`，对商圈不生效**（线上 `curl https://shangban.cc/shanghai` 可见 `…listings?district=lujiazui`，页面实际是未筛选的全城列表）。
- 资讯详情「相关商圈」→ `/shanghai/area/<slug>`（给文章 6 挂了陆家嘴 / 南京西路后实测）。
- 落地页「相关资讯」按 `relatedDistricts` 查询：浦东页出现挂在浦东（文章 7）与其下辖商圈陆家嘴（文章 6）上的两篇。

## 截图

`desktop-business-area-top.jpg`、`desktop-business-area-faq.jpg`、`desktop-district-buildings-news.jpg`、`mobile-375-district.jpg`。

## 未验证

生产环境的真实表现、Google 富媒体测试、百度收录、Core Web Vitals；用生产真实量级数据（14 区 / 61 商圈、3.6 万套）跑统计 SQL 的耗时——本地只有 55 套。上线后先看 `/shanghai/area/xuhui` 的首次冷请求耗时与连接池占用（统计索引走 300s 缓存，冷未命中是一次整城扫描）。
