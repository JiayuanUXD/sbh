# OPT-128 实施前核实结论

核实日期：2026-11-16。分支：`feat/opt-128-bot-guard-7c3a`。只读核实，未改任何产品代码。

## 结论总览

| # | 事项 | 结论 | 与设计假设 |
| - | ---- | ---- | ---------- |
| 1 | 各引擎 rDNS 验真后缀 | Google、Bing、百度有官方 rDNS 方法；搜狗、360 官方无 rDNS 方法（标 `none`） | 基本相符；搜狗、360 须走「未决」档；百度正向确认有风险，见下 |
| 2 | 媒体真实路径 | `/api/media/file/<文件名>?prefix=media` | 相符 |
| 3 | CloudRun 最大 / 最小实例数 | 未核实 | 待用户配合 |
| 4 | 小程序页码依赖 | 没有任何地方依赖第 50 页之后，但「加载更多」无上限，可自然翻到 50 页以后 | 部分相符，见下 |

## 1. 搜索引擎官方验真方法

| 引擎 | rDNS 后缀 | 官方文档 | 备注 |
| ---- | --------- | -------- | ---- |
| Google | `.googlebot.com`、`.google.com`、`.googleusercontent.com` | https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot | 官方：反查 -> 主机名属于上述域 -> 正查回原 IP。常规爬虫为 `crawl-*.googlebot.com`，特殊爬虫 `rate-limited-proxy-*.google.com`，用户触发抓取 `*.gae.googleusercontent.com` / `google-proxy-*.google.com` |
| Bing | `.search.msn.com` | https://blogs.bing.com/webmaster/2012/08/31/how-to-verify-that-bingbot-is-bingbot | 官方：反查以 search.msn.com 结尾，再正查回原 IP；Bing 不公布固定 IP 段 |
| 百度 | `.baidu.com`、`.baidu.jp` | https://help.baidu.com/question?prod_id=99&class=0&id=3001 | 官方只写反查后缀，示例 `baiduspider-123-125-66-120.crawl.baidu.com`；**官方页没写正向确认**。第三方博客（https://skywt.cn/blog/nginx-rdns-judge-spiders ，非官方）称该类主机名正查可能 NXDOMAIN，未经我独立验证 |
| 搜狗 | `none` | https://www.sogou.com/docs/help/webmasters.htm | 官方站长页只讲爬虫说明与 robots，没有验真方法。第三方称主机名形如 `sogouspider-*.crawl.sogou.com`，但非官方，不采信为放行依据 |
| 360 | `none` | https://www.so.com/help/spider_ip.html | 官方明确「暂时不支持 nslookup 查询」，只公布 IP 段（42.236.10/12/17/101.\*、180.153.236.\*、180.163.220.\*，另有 PDF 明细）。UA 以 `360Spider` 结尾 |

对设计的影响：

- 设计 §5.4「官方没有公布 rDNS 方法的引擎不得仅凭 UA 放行」：搜狗、360 按 `none` 处理，走「未决」档（阈值放大 10 倍、不做 UA 拦截），或另行决策是否对 360 采用官方 IP 段比对（官方有明确清单，但清单会变，需单独评估）。
- 百度：常量表放 `.baidu.com`、`.baidu.jp`。若严格要求「正向解析必须含该 IP」，百度可能永远得到「不匹配」而被限速，伤 SEO。实施时应让百度的正向确认可配置（例如正查失败但反查后缀合格时判「未决」而非「不匹配」），并靠 observe 期 `se_verified` 门槛实测。
- 文档抓取工具对 Bing 官方帮助页（bing.com/webmasters/help）只拿到标题，Bing 结论取自 Bing 官方博客。

## 2. 媒体真实路径

命令：`rg -n "api/media/file" payload-office-platform/src`。

- 代码引用：`src/collections/Media.ts:38`、`src/components/frontend/HomeHeroMedia.tsx:16`（`/api/media/file/hero-bg.mp4?prefix=media`）、`src/app/(frontend)/entrust/page.tsx:50`、`publish/page.tsx:42`、`src/lib/frontend/detail-metadata.ts:295`、`src/lib/storage/media-file-cache.ts:2`。
- 线上实测（1 次 sitemap GET + 1 次详情页 GET，带普通浏览器 UA）：取 `https://shangban.cc/sitemaps/shanghai/listings/1.xml` 首个房源 `https://shangban.cc/shanghai/listings/jia-li-bu-ye-cheng-4-0-0-jing-zhuang-xiu-huizu-58732`，其 HTML 内图片 URL 为 `/api/media/file/hzx-b335-1-768x513.webp?prefix=media`、`/api/media/file/hzx-b460-1-768x576.webp?prefix=media`。
- 结论：前缀就是 `/api/media/file/`，且带 `?prefix=media` 查询参数（限速 / 白名单规则匹配路径时不要把查询串算进去）。

## 3. CloudRun 最大 / 最小实例数

- 命令：`mcp__cloudbase__auth(action=status)`。
- 结果：`auth_status=REQUIRED`、`env_status=NONE`，本地 CloudBase MCP 未登录，登录要走浏览器授权，agent 无法代为完成，故未调用 `queryCloudRun`。
- 结论：**未核实**。线索：`DEPLOYMENT.md:45` 有待办「把 CloudRun `MinNum` 1→0」，说明当前 `MinNum` 大概率为 1（仅为文档线索，非实测）。`MaxNum` 无任何记录。
- 需要用户：在控制台读 `sbh` 服务的扩缩容 MaxNum/MinNum，或先在本机 MCP 完成登录（`auth start_auth`）后重跑。影响 §5.5：进程内限速计数按实例独立，实际总额度约等于 MaxNum × 单实例额度。

## 4. 小程序页码依赖

命令：`rg -n "page" sbh-miniprogram --glob '*.ts' --glob '*.js'`，并细读 `miniprogram/`。

- 带 `page` 请求列表接口的唯一出口：`miniprogram/services/catalog.ts:87`（`page=`、`pageSize=`），调用方为：
  - 房源列表 `pages/listings/controller.ts:285/290/337/342`：刷新、替换均 `nextPageQuery(.., 1)`；仅「加载更多」用 `pagination.page + 1`，且受 `hasNextPage` 控制。
  - 楼盘列表 `pages/buildings/index.ts:178/183`：`page + 1`，受 `hasNextPage` 控制。
  - 资讯列表 `pages/news/index.ts:45`：同上。
- 没有任何硬编码的大页码、跳页、深链到第 N 页。唯一允许深页的入口是 `domain/listing-query.ts:248/286` 解析 `page` 上限 10000（来自页面参数 / 分享 query，如 `page=3` 的用例）。
- **与设计假设的差异（需关注）**：小程序没有「依赖第 50 页之后」的代码，但「加载更多」逐页追加、没有上限，用户连续下拉理论上能到第 51 页以后（每页 24 条，> 1200 条结果时）。封顶后，小程序在第 50 页后 `hasNextPage` 须为 `false`（或服务端对越界页返回合法空页），否则 `catalog-contracts.ts` 的响应校验、`res.pagination.page !== page` 一致性检查（`buildings/index.ts:203`）会把越界响应当错误。另外 `listing-query.ts` 的 10000 上限与 `MAX_PUBLIC_PAGE=50` 应对齐（客户端解析侧）。小程序 MP-105 仍在验收，改动前需与该侧确认。
