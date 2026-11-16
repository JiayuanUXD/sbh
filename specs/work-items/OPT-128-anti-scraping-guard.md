# Task Packet：OPT-128 房源信息防批量抓取（应用内收口）

> 状态：**已实现于分支 `feat/opt-128-bot-guard-7c3a`，待观察期上线**（2026-11-16）。方案路线 A 已由用户选定；D5、D6 已确认。合并后生产以 `observe` 运行，满足 §6 的四项核对后才切 `enforce`。
> 创建日期：2026-11-16
> 来源：用户要求「防止房源信息被抓取」；2026-11-16 对生产站的只读探测与代码核对
> 前置：OPT-017（分布式限流）、OPT-098（主域名与 `src/proxy.ts`）、OPT-069（图片水印）

---

## 0. 决策记录

| # | 决策 | 取向 | 状态 |
|---|---|---|---|
| D1 | 路线 | **A：应用内收口**（数据面收紧 + 应用内分级限速）；B（网关前接 EdgeOne 一类 CDN/WAF）留作第二期 | 用户已选 |
| D2 | 目标强度 | 让批量抓取**变慢、变贵**，不承诺绝对防住；人眼能看到的页面，决心够大的人总能复制 | 我的判断，待确认 |
| D3 | 搜索引擎 | 必须放行，**以反向 DNS 验真为准，不只看 UA** | 我的判断 |
| D4 | 上线方式 | 开关 `BOT_GUARD_MODE=off\|observe\|enforce`，**生产默认 `observe`**（只记日志、不拦），数据证明安全后再手动切 `enforce` | 我的判断（合并即上线，见仓库根 `CLAUDE.md`） |
| D5 | 列表页码封顶 | 公开列表与小程序列表**可翻页数上限为 50**（现状允许到 10000；每页 24 条，即单个查询最多可翻到前 1200 条），超出时走明确的越界空态并提示「请增加筛选条件」，**不是**静默回落到第 1 页 | **需用户确认**（改用户可见行为，并影响已被索引的深页） |
| D6 | robots 里是否点名禁 AI / SEO 工具爬虫 | **本工作项不动 robots.txt** | **需用户确认**（禁 AI 爬虫会影响 AI 搜索可见度） |
| D7 | 登录墙、验证码、JS 挑战 | **不做**（登录墙伤 SEO 与咨询转化；挑战属路线 B） | 我的判断 |
| D8 | 联系方式点击后展示 | **撤回**。顾问卡展示的是平台级客服电话，全站同一个号（`AdvisorCard.tsx` 头部不变量：不显示个人手机号），没有逐房源的联系方式可抓 | 已核实 |

## 1. 一句话

在请求到达数据库之前，用 `src/proxy.ts` 给公开页面、站点地图、图片和小程序读接口加一层按 IP 的分级限速与脚本 UA 拦截，放行经验证的搜索引擎，并把可被无限翻页的查询空间收窄；先观察、再强制。

## 2. 现状与证据

| 观察 | 证据 | 含义 |
|---|---|---|
| 完全没有爬虫防护 | `src/proxy.ts` 只做域名 301，且 matcher 排除 `/api`、`/_next`；`robots.ts` 对所有 UA `allow: /` | 起点为零 |
| 限流只覆盖写接口 | 询盘、会员登录、短信等走 PG 分布式限流（`rate-limit-distributed.ts`），读页面与读接口无任何限制 | 读面完全开放 |
| 现有限流器不能直接套页面 | 每次检查 `keyExists` + `countKeys`（新 key 时）+ `acquire`，共 2–3 次查库；生产连接池上限 20（`DEPLOYMENT.md`，`db-pool-options.ts`），已因连接池被占满出过两次事故（病因是慢 SQL，不是流量） | 页面限速必须在内存里做，不能再给连接池加压 |
| 站点地图递出全部房源链接 | 2026-11-16 探测：`/sitemap.xml` 索引 78 个分片，单个房源分片 500 条 URL | 抓取者不用爬行，拿清单逐条请求即可 |
| 网关前没有 CDN/WAF | 响应头 `server: tcbgw`，无缓存或防护层痕迹，首页 `no-store` | 流量直达容器 |
| 小程序读接口匿名可调 | `/api/mini/v1/{home,listings,buildings}` 路由无鉴权；结果走 `unstable_cache`（300s）但**以查询入参为键** | 变换筛选参数即制造无限个冷键；2026-11-16 一次探测上游耗时 11.7s（单样本，可能是未命中缓存），另一次 GET 20s 内无返回，随后停止探测 |
| 页码上限过大 | `search-params.ts:259-262`：`parseIntInRange(sp, 'page', 1, 10000)`，超出范围时 `n ?? 1` **静默回落到第 1 页** | 一个筛选条件可翻到第 10000 页；同时说明封顶不能靠直接改这个上限实现（见 §5.7） |
| 真实客户端 IP 来源未验证 | `request-guards.ts#clientIp` 优先信 `x-real-ip`；网关是否覆盖该头无文档。小程序侧已有「可信代理跳数」解析（`mini/v1/rate-limit-state.ts:29-40`，env `MINI_TRUSTED_PROXY_HOPS`） | 不确认 IP 来源就按 IP 限速，会拦不住人或误伤 |
| 真实访问量很小 | 近 30 天访客约 3.4k（OPT-126 §2，2026-11-02 读取） | 合法单 IP 的访问量远低于任何抓取行为，阈值可以给得宽而仍有效 |
| 房源卡片已关预取 | `ListingCard.tsx` 使用 `prefetch={false}` | 列表页不会因预取在一秒内打出几十个详情请求 |

## 3. 目标与非目标

目标：

1. 单个 IP 无法在短时间内抓完全站房源：需要从「几小时」拉长到「必须使用 IP 池」。
2. 脚本类 UA（`python-requests`、`curl`、`Go-http-client`、`HeadlessChrome` 等）与空 UA 在 `enforce` 下被直接拒绝。
3. 经验证的搜索引擎不受任何影响。
4. 可无限翻页的查询空间收窄到有限，降低冷缓存键造成的重查询。
5. 全程可观察：日志能回答「有没有人在抓、从哪类路径、被拦了多少」，且**不需要发版**就能在 `off / observe / enforce` 之间切换。

非目标（不是疏漏）：

- 不防分布式代理池低频抓取（路线 B 的范围，见 §10 的第二期触发条件）。
- 不做登录墙、验证码、JS 挑战、盲水印、防盗链（OPT-069 已明确不做防盗链与限速）。
- 不改既有写接口的 PG 限流（`inquiry_rate_limit` 及其配置）。
- 不新增数据库表与迁移。
- 不碰 robots.txt（D6）。

反目标（即使技术上成功也算失败）：

- 误伤任何正规搜索引擎或微信分享卡片抓取。
- 在商办写字楼共享出口 IP（企业 NAT）下误伤真实用户，多于挡住抓取者。
- 给人类访客增加任何摩擦（拦截页、验证码、跳转）。

## 4. 方案比较（摘要）

| | 内容 | 取舍 |
|---|---|---|
| **A（选定）** | 数据面收紧 + `proxy.ts` 内存分级限速 + UA 拦截 + 搜索引擎验真 | 一两天可上线、可灰度、不碰生产域名；被 IP 池绕过，且每实例各自计数、流量仍会打到容器 |
| B | 网关前接 EdgeOne 一类 CDN/WAF，用其 Bot 管理与挑战 | 最强，流量不进容器；新增费用与服务、要改 DNS 与证书（证书 2026-11-25 到期，本就要重做），EdgeOne 套餐能力尚未核实 |
| 登录墙 | 看价格/详情须登录 | 最强但与 SEO、咨询转化冲突，已排除 |

## 5. 设计

### 5.1 位置与顺序

`src/proxy.ts` 在现有「主域名 301」之后接入守卫：先决定是否 301，**只有落在主域名上的请求才进守卫**，避免对同一请求双重计数。新代码放 `src/lib/bot-guard/`，`proxy.ts` 只做接线（沿用 OPT-098 的写法：判定逻辑是纯函数、单测覆盖，proxy 只接线）。

matcher 需要扩展：现在是 `'/((?!api$|api/|_next/).*)'`，要额外覆盖 `/api/mini/v1/:path*` 与 `/api/media/file/:path*`。**必须保持不匹配** `/api/health`（CI 冒烟用 curl 打它）、`/admin`、`/_next`、`/favicon.ico`、`/robots.txt` 以及其它 `/api/*`。

### 5.2 路径分类 `classifyPath`（纯函数）

| 类别 | 路径 | 说明 |
|---|---|---|
| `page` | 公开站 HTML 导航（含列表、详情、搜索、资讯） | RSC 导航计入 |
| `page-prefetch` | 带预取头（`next-router-prefetch` / `Purpose` / `Sec-Purpose`）的页面 GET/HEAD | **不豁免，单独计桶**，见下方裁决 |
| `sitemap` | `/sitemap.xml`、`/sitemaps/**` | 人类几乎不读，限得最严 |
| `media` | `/api/media/file/**` | 阈值高：一个详情页要加载约二十张图 |
| `mini-read` | `/api/mini/v1/{home,listings,buildings}`（含详情） | **一期仅 `observe`**，见 §5.7 |
| `exempt` | 其余全部 | 不进守卫 |

**裁决（2026-11-16）：预取请求不豁免。** 预取头由客户端自报，可被任意伪造；若整体豁免，爬虫只需加一个请求头就绕过全部限速。故带预取头的页面 GET/HEAD 归入独立的 `page-prefetch` 类别，计入自己的桶、同样受 `enforce` 约束。额度取宽（突发 200 / 每分钟 300 / 每小时 3000），因为每次页面访问会触发约 12 个 Next RSC 预取请求（页头 / 页脚链接），Task 7 验证中真人快速翻页已耗尽过更小的额度（旧值 60/120/1200）。已接受的权衡：伪造预取头的爬虫最多拿到这档额度，且只能拿到 RSC payload。

### 5.3 客户端 IP `resolveGuardClientIp`

- 沿用「可信代理跳数」做法：取 `x-forwarded-for` 链中**倒数第 N 个**，N 由 `BOT_GUARD_TRUSTED_PROXY_HOPS` 给定，并校验链中全部是合法 IP。
- **不新造第三份解析逻辑**：把 `mini/v1/rate-limit-state.ts` 里的链解析核心抽成共享纯函数，小程序侧改为调用它，既有测试保持绿（仓库反复栽在「同一判断逻辑存在多份副本」上，见 `.agent/frontend.md`）。
- **解析失败（无头、链非法、跳数超出）→ 该请求不受限速，只记 `ip_unresolved`**。绝不能把解析失败的请求归到同一个 `unknown` 桶，否则 `enforce` 下全站会共用一个配额。
- 上线门槛：`observe` 期的日志显示 `ip_unresolved` 占比 < 1%、链长度恒定，才允许切 `enforce`（用这份数据确定跳数，而不是猜）。

### 5.4 搜索引擎验真 `verifySearchEngine`（注入 resolver，纯逻辑可单测）

流程：UA 声称是某引擎 → 对客户端 IP 做反向 DNS → 主机名后缀属于该引擎 → 再正向解析该主机名，结果须包含该 IP → 验真通过。

- 引擎与后缀表写成常量（`search-engine.ts` 的 `ENGINES`），**已逐家对照官方「如何验证爬虫」文档**。最终表：

| 引擎 | UA 特征 | rDNS 主机后缀 | 正查宽松（`forwardLenient`） |
|---|---|---|---|
| `baidu` | `baiduspider` | `.baidu.com`、`.baidu.jp` | 是 |
| `google` | `googlebot` | `.googlebot.com`、`.google.com`、`.googleusercontent.com` | 否 |
| `bing` | `bingbot` | `.search.msn.com` | 否 |
| `sogou` | `sogou` | 无（官方无 rDNS 验证方法） | 否 |
| `so360` | `360spider` / `haosouspider` | 无（官方无 rDNS 验证方法） | 否 |

  搜狗与 360 没有官方 rDNS 方法，**不得仅凭 UA 放行**，恒为「未决」档（`unresolved`）。
- 细节取舍：
  - **空 PTR**（反向查询无结果）：仅百度判「未决」（避免公网反向区回 NXDOMAIN 的 resolver 把真百度标成伪造）；谷歌、必应判「伪造」。
  - **IPv6 规范化**：缓存键与正查比对前，IPv4 原样、`::ffff:a.b.c.d` 解包、IPv6 经 URL 解析器压缩 / 小写 / 去前导零，保证同一地址只有一种写法。
  - **候选 PTR 主机名最多 3 个**：只对后缀合格的前 3 个做正向查询，防止攻击者控制的多名 PTR 拖慢验真。
  - 正查：严格引擎网络失败判「未决」、成功但不含该 IP 判「伪造」；宽松引擎（百度）一律判「未决」。
- 结果缓存：通过 24h、不匹配 10min，LRU 上限 5000；DNS 超时 1s。
- 三种结果，处理不同：
  - **验真通过** → 豁免限速（仍计入日志）。
  - **明确不匹配**（rDNS 明确不属于该引擎，即伪造 UA）→ 当作普通客户端，照常限速与 UA 规则。
  - **未决**（超时 / DNS 不可用）→ 阈值放大 10 倍，**不做 UA 拦截**。理由：容器内 DNS 是否可用是未验证的假设，一旦失效，若按「不匹配」处理就会把真搜索引擎全部限速，直接伤 SEO。
- 上线门槛：`observe` 期必须看到至少一家真实引擎出现 `se_verified`，证明容器内验真链路可用，才允许切 `enforce`。

### 5.5 限速器 `limiter`（进程内、纯函数 + 注入时钟）

- 键：`(ip, class)`。结构：令牌桶（应对突发）+ 小时预算计数（真正限制总量）。
- 小时预算是关键：只有突发桶的话，单 IP 以持续 0.5–1 次/秒照样能在一天内抓完全站；小时预算把它压成「必须上 IP 池」。
- 容量保护：Map 上限 50,000 个键，超限淘汰最久未用；周期性清扫过期键，**内存不得无界增长**（有单测）。
- 超限返回 `429` + `Retry-After`，`Cache-Control: no-store`，页面类用简短纯文本，**不暴露命中的是哪条规则**。
- 初值（**我的判断，必须靠 `observe` 日志校准后再 `enforce`**）：

| 类别 | 突发 | 持续（/分钟） | 小时预算 |
|---|---|---|---|
| `page` | 30 | 30 | 600 |
| `sitemap` | 5 | 5 | 12 |
| `page-prefetch` | 200 | 300 | 3000 |
| `media` | 100 | 300 | 3000 |

- 有效阈值 = 每实例阈值 × 实例数。**实施前需用 `queryCloudRun` 核实最大实例数**（我没查到文档记录），按保守值取。
- 自家运维 / 监控 / SEO 审计工具的出口 IP 用 env `BOT_GUARD_ALLOW_IPS`（逗号分隔，默认空）豁免。自己跑站点审计（如爬全站）会撞限速，这是已知后果，用该变量解决。

### 5.6 脚本 UA 规则 `classifyUserAgent`（纯函数）

空 UA，以及 `python-requests`、`python-urllib`、`aiohttp`、`httpx`、`curl/`、`wget/`、`libwww-perl`、`Go-http-client`、`Java/`、`Apache-HttpClient`、`scrapy`、`node-fetch`、`axios`、`HeadlessChrome`、`PhantomJS` 等 → `enforce` 下返回 `403`。

**对自动化浏览器的后果**：`HeadlessChrome`（Playwright 默认 UA）在 `enforce` 下返回 403。对 `enforce` 环境跑 Playwright / 无头浏览器验收，需要换用其它 UA，或把出口 IP 加进 `BOT_GUARD_ALLOW_IPS`。

诚实说明：UA 可伪造，这条只挡偷懒的脚本，价值是几乎零误伤。**不拦**微信 / 微博等分享卡片抓取与 Lighthouse 一类工具（它们有各自 UA，不在名单内）。名单是常量，单测覆盖，加减不需要改逻辑。

### 5.7 数据面收紧

1. **页码封顶（D5，需确认）**：常量 `MAX_PUBLIC_PAGE = 50` 只在一处定义。★ **不能直接把 `parsePage` 的 10000 改成 50**：它对超范围值静默回落到第 1 页，改了之后第 51 页会悄悄显示第 1 页——重复内容，且用户不知道发生了什么。做法是 `parsePage` 保持宽容解析，**另在解析之后判定** `page > MAX_PUBLIC_PAGE`，走既有「页码越界」空态（`.agent/frontend.md`「状态」③：只讲页码不存在、给出口，不说没有结果）。结果总数超过上限时，分页处**如实提示**「结果较多，仅显示前 50 页，请增加筛选条件」，不得伪装成总共只有这么多。同时要核对越界空态里的「最后一页」出口指向的是封顶页，而不是真实最后一页。小程序列表同口径；小程序仍在验收（MP-105），实施时需与该侧确认没有依赖更深页码。
2. **站点地图**：不加鉴权（要给搜索引擎读），只受 `sitemap` 类限速保护。`lastmod` 保持真实值，不动（OPT-118）。
3. **`mini-read` 一期只 `observe`**：小程序若经 `wx.cloud.callContainer` 访问，容器看到的来源 IP 不一定是终端用户，按 IP 限速可能把所有小程序用户当成同一个人。这一点未验证。`observe` 期要在日志里区分「经公网网关」与「经微信云」两类来源，再决定是否对 `mini-read` 强制限速。页码封顶对 mini 仍然生效。
4. **冷键放大**：`unstable_cache` 以入参为键，变换筛选参数会不断制造未命中的重查询。页面类限速加页码封顶已经把它收窄到有限范围；一期**不**为此再引入并发闸门或查询白名单。

### 5.8 日志（不暴露 PII）

对非放行决策与验真结果，每条一行结构化 JSON；另每 5 分钟一行按类别汇总的计数。字段：时间、`mode`、路径类别、决策（`would_limit` / `would_deny` / `limited` / `denied` / `se_verified` / `se_spoofed` / `ip_resolved` / `ip_unresolved`）、命中规则、**IP 的截断 HMAC 哈希**、UA 的第一个产品令牌。**不记原始 IP、完整 UA、路径与 query**（`.agent/frontend.md`「咨询」：不在日志暴露 PII）。实施时对照 `src/lib/observability` 的既有写法。

两条量控规则（`log.ts`）：
- **逐条行数封顶**：每个 `kind:类别` 键在每个 5 分钟窗口内最多逐条写 20 行（`MAX_LINES_PER_KEY_PER_WINDOW`），超出的只计数，并在汇总行的 `suppressed` 里给出被压掉的条数，防止洪水式日志。
- **IP 解析结果与 `se_verified` 只计入汇总**。每个进入守卫 IP 解析的请求计入一次 `ip_resolved` 或 `ip_unresolved`，汇总行的 `xffChainLength` 分布（`0 / 1 / 2 / 3+`）覆盖这两种结果。

### 5.9 开关与回滚

- `BOT_GUARD_MODE`：`off`（守卫整体跳过）/ `observe`（计算并记日志，**不改变响应**）/ `enforce`（真正返回 403/429）。非生产环境默认 `off`，生产默认 `observe`。
- 服务级环境变量在控制台 / MCP 修改，代码部署不会清空它（见 `CLAUDE.md`「CloudBase 部署事实」），所以切换与回滚都**不需要发版**。
- 页码封顶不受该开关控制（它是代码行为），因此 D5 要单独确认。

## 6. 上线步骤

1. 合并后以 `observe` 运行。跳数未设置时先观察链长度，并结合网关转发规则和受控来源请求确认客户端 IP 的位置。确认后，在 `observe` 状态设置 `BOT_GUARD_TRUSTED_PROXY_HOPS`。
2. 跳数生效后观察至少 7 天，用 CloudRun 日志核对四项。
   - 按类别合计 `counts` 中的 IP 解析结果，`ip_unresolved / (ip_resolved + ip_unresolved)` 低于 1%。
   - 至少一家真实搜索引擎出现 `se_verified`。
   - `would_limit` / `would_deny` 中无明显真人误判，据此校准 §5.5 的阈值。
   - 核对真实客户端 IP 来源。Next 会用 socket 地址补齐缺失的 `x-forwarded-for`，因此解析成功也可能取到网关地址。比对实际代理链与 `xffChainLength` 分布，用多个已知出口发送少量受控请求，核对 `would_deny` 等逐条日志中的 IP 哈希能区分来源。每个类别和事件组合每 5 分钟最多记录 20 行。若某个哈希占绝大多数，排查代理链和共享出口后再决定是否切换。
3. 四项通过并经用户确认后，在控制台设置 `BOT_GUARD_MODE=enforce`，持续观察 24 小时。异常时改回 `observe`。

## 7. 测试

纯逻辑严格 TDD（先红后绿）：

- `classifyPath`：矩阵覆盖 `/api/health`、`/admin`、`/_next`、`/robots.txt`、站点地图、媒体、mini、列表、详情；预取请求归 `page-prefetch`（不豁免）。
- `classifyUserAgent`：名单与大小写、空 UA、分享卡片 UA 不被误拦。
- `limiter`：注入时钟；突发、持续补充、小时预算、淘汰到 `maxKeys`、内存有界。
- `resolveGuardClientIp`：跳数 1–3、伪造的首段 XFF、链含非法 IP、无头 → 未解析 → 豁免。
- `verifySearchEngine`：fake resolver 覆盖通过 / 伪造 UA / 正向不匹配 / 超时（未决）/ 缓存 TTL。
- 模式矩阵：`off` / `observe` / `enforce` 下响应各是什么，`observe` 绝不改变响应。
- 契约测试（读 `proxy.ts` 源码，沿用仓库的 fs 契约测试写法）：matcher 覆盖预期路径，且不匹配 `/api/health`。变异验证：故意改坏 matcher，确认契约测试如期变红。

按 `CLAUDE.md`，完成前必须在浏览器里实际走一遍，证据存 `artifacts/verification/OPT-128/`：

- 本地 `next start`（先 `ls .env.production*`，别连生产库）+ `enforce`：正常浏览列表、详情、搜索不被拦；`curl` 默认 UA 得 403；伪造 `Googlebot` UA 但 rDNS 不匹配的请求按普通客户端处理；循环请求超过突发额度得 429 且带 `Retry-After`。
- 页码越界：第 51 页走越界空态，结果超限时提示文案如实。
- `observe` 下上述请求全部 200，但日志出现对应 `would_*` 记录。
- 验不到的要明说验不到（例如容器内 DNS 验真链路只能在生产观察期里验证）。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 企业共享出口 IP 误伤 | 阈值宽松、只回 429 + `Retry-After`（无永久封禁）、`BOT_GUARD_ALLOW_IPS`、先 `observe`；真实访问量很小（§2） |
| 容器内 DNS 不可用导致真搜索引擎被限速 | 「未决」档放大 10 倍且不做 UA 拦截；切 `enforce` 前必须见到 `se_verified` |
| 真实 IP 来源错误导致误判或失效 | 解析失败即豁免；按 §6 核对解析失败率与客户端 IP 来源 |
| 进程内计数只覆盖单实例，重启即清零 | 阈值按实例数折算；这是路线 A 的固有局限，由路线 B 补 |
| Next dev 热更新重置模块状态 | 只影响本地，生产是单个 Node 进程；实施时在 `next start` 下验证模块级状态确实跨请求保留 |
| 页码封顶影响已被索引的深页 | D5 单独确认；详情页仍可经站点地图被收录 |

## 9. 影响面与文件

新增 `src/lib/bot-guard/`（配置、路径分类、UA、客户端 IP、搜索引擎验真、限速器、守卫编排、日志）与对应 `tests/bot-guard-*.test.ts`。修改：`src/proxy.ts`（接线与 matcher）、`src/domain/public-catalog/search-params.ts`（页码封顶，唯一出处）、分页组件与越界空态文案、`mini/v1/rate-limit-state.ts`（改调共享的链解析函数）。文档：`DEPLOYMENT.md` 记录三个 env；`.agent/frontend.md` 补页码封顶规则。**无迁移、无新表。**

## 10. 第二期触发条件（路线 B）

满足任一条即评估接 EdgeOne 一类前置：`enforce` 稳定运行后，日志里仍看到分布式低频抓取（大量不同 IP、各自低于阈值）；或容器负载 / 连接池仍被爬量拖高。届时 §5.7 的数据面收紧依然有效，不会白做。

## 11. 实施前必须先核实的事项

- 核对各搜索引擎官方的爬虫验真方法与 rDNS 后缀（§5.4）。
- 用 `queryCloudRun` 核实最大实例数（§5.5）。
- 确认媒体文件的真实路径是 `/api/media/file/**`（它由 Payload 路由提供，我没在 `src/app` 下找到独立的 route 文件）。
- 确认小程序侧没有依赖超过第 50 页的列表（§5.7）。
- 开分支必须从最新 master：`cd payload-office-platform && pnpm branch:new feat opt-128 bot-guard`。当前所在分支 `perf/search-listing-prematch-building-ids-ab39` 是另一件事，本文件不要混进它的提交。
