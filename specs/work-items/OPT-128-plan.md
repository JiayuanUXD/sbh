# OPT-128 房源防批量抓取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在请求到达数据库之前，用 `src/proxy.ts` 对公开页面、站点地图、图片、小程序读接口做按 IP 的分级限速与脚本 UA 拦截，放行经反向 DNS 验真的搜索引擎，并把公开列表可翻页数封顶到 50。

**Architecture:** 新增 `src/lib/bot-guard/`，由纯函数（路径分类、UA 规则、可信 IP 解析、令牌桶限速、搜索引擎验真、守卫编排）组成，依赖（时钟、DNS、日志）全部注入；`proxy.ts` 只做接线，且守卫内部任何异常都放行。开关 `BOT_GUARD_MODE=off|observe|enforce`，生产默认 `observe`。页码封顶落在分页元数据的唯一构造点，并让既有「页码越界」空态如实说明。

**Tech Stack:** Next.js 16（`proxy.ts`，Node 运行时，可 `async`）、TypeScript、Vitest（`tests/**/*.test.ts`）、`node:dns/promises`、`node:crypto`、`node:net`。

**Spec:** `specs/work-items/OPT-128-anti-scraping-guard.md`（D5 页码封顶 50、D6 不动 robots.txt 已由用户 2026-11-16 随「定稿」确认）

## Global Constraints

- 开关：`BOT_GUARD_MODE` 取 `off` / `observe` / `enforce`；非生产默认 `off`，生产（`NODE_ENV=production`）默认 `observe`；非法值回落默认。`observe` **绝不改变响应**。
- 限速初值（每实例）：`page` 突发 30 / 30 每分钟 / 600 每小时；`sitemap` 5 / 5 / 12；`page-prefetch` 200 / 300 / 3000（预取头可伪造，故不豁免、单独计桶；每页约 12 个预取，2026-11-16 裁决）；`media` 100 / 300 / 3000。`mini-read` 一期只 `observe`，用 `page` 的数值，且不在 `ENFORCED_CLASSES` 内。
- 限速 Map 上限 `50_000` 个键，超限淘汰最久未用，内存有界。
- 搜索引擎验真：通过缓存 24h、不匹配缓存 10min，LRU 上限 5000，DNS 超时 1s。三态：`verified` 豁免；`spoofed` 当普通客户端；`unresolved`（超时 / DNS 不可用 / 官方无 rDNS 方法的引擎）阈值放大 10 倍且**不做 UA 拦截**。永远不得仅凭 UA 放行。最终引擎表见 spec §5.4（搜狗、360 无官方 rDNS 方法，恒 `unresolved`；空 PTR 仅百度判 `unresolved`，谷歌 / 必应判 `spoofed`；IPv6 先规范化；候选 PTR 主机名最多 3 个）。
- 脚本 UA 在 `enforce` 返回 `403`；超限返回 `429` + `Retry-After` + `Cache-Control: no-store`；响应体不暴露命中的规则。
- 日志**不记**原始 IP、完整 UA、路径、query；IP 用截断 HMAC 哈希；每 5 分钟一行汇总计数；每个 `kind:类别` 每窗口最多逐条写 20 行，超出计入汇总的 `suppressed`；`ip_unresolved` / `se_verified` 只计数不逐条写。
- `proxy.ts` matcher 必须保持**不匹配** `/api/health`、`/admin`、`/_next`、`/favicon.ico`、`/robots.txt` 与其它 `/api/*`；仅新增 `/api/mini/v1/:path*` 与 `/api/media/file/:path*`。
- `MAX_PUBLIC_PAGE = 50`，`pageSize` 固定 24；`parsePage` 保持宽容解析（10000），封顶在分页元数据层判定，**不得**直接改 10000。
- **无数据库迁移、无新表**；不碰既有写接口的 PG 限流（`inquiry_rate_limit`）。
- 文档 / 注释 / 提交信息的中文用简体中文；用 `pnpm`；提交只用显式 `git add <具体路径>`，禁用 `git add -A` / `.` / `commit -am`；提交信息不加署名行；不要恢复或提交 `public/prd/*.md` 的删除。
- 仓库规定「合并即上线」：本计划所有任务在功能分支上完成，开分支用 `cd payload-office-platform && pnpm branch:new feat opt-128 bot-guard`；**提交与推送须在用户明确同意后才做**。
- 若 vitest / tsx 报缺 `darwin-x64` 绑定，命令前缀 `arch -arm64`；推送用 `/usr/bin/git`。

## Review Focus

1. 守卫内部抛错（DNS 抛异常而非返回空、日志写入失败）：必须放行并计数，**绝不能让 `proxy` 抛出导致全站 500**。→ Task 3
2. `x-forwarded-for` 项带端口（`1.1.1.1:443`）、IPv6、`::ffff:1.2.3.4`：一律按「未解析」处理而不是崩溃，且未解析即豁免。→ Task 1
3. 非 `GET`/`HEAD`（Server Action 的 POST、`OPTIONS`）不得计入配额；Next 预取请求**不豁免**（预取头可伪造），归入独立的 `page-prefetch` 类别、用自己的桶（200 / 300 / 3000），且在 `ENFORCED_CLASSES` 内。→ Task 1
4. 真人合理浏览（企业 NAT 下 40 分钟内翻 40 页、看 20 套详情）不触发任何限速。→ Task 1
5. `page=51`、`page=0`、`page=abc`：第 51 页走越界空态且文案如实（不说「只有 50 页」当真实页数更多时），并且不执行 OFFSET 扫描；真实总页数 ≤ 50 时行为与现状完全一致。→ Task 5、6
6. 超长 / 含控制字符 / 非 ASCII 的 UA：不抛错，日志里的 UA 族名被截断过滤。→ Task 1、3

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/api/trusted-client-ip.ts`（新） | 可信代理跳数解析客户端 IP 的共享纯函数 |
| `src/lib/bot-guard/path-class.ts`（新） | 请求归类与预取判定 |
| `src/lib/bot-guard/user-agent.ts`（新） | 脚本 UA 规则与日志用 UA 族名 |
| `src/lib/bot-guard/limiter.ts`（新） | 进程内令牌桶 + 小时预算，内存有界 |
| `src/lib/bot-guard/config.ts`（新） | 环境变量解析与全部常量 |
| `src/lib/bot-guard/search-engine.ts`（新） | 搜索引擎声明识别、反向 DNS 验真、缓存 |
| `src/lib/bot-guard/log.ts`（新） | 结构化日志与 5 分钟汇总 |
| `src/lib/bot-guard/guard.ts`（新） | 编排与模式应用，纯逻辑 |
| `src/lib/bot-guard/runtime.ts`（新） | 进程级单例与真实依赖，`runBotGuard(request)` |
| `src/proxy.ts`（改） | 接线与 matcher |
| `src/domain/public-catalog/page-cap.ts`（新） | `MAX_PUBLIC_PAGE`、`capTotalPages` |
| `src/domain/public-catalog/{stable-sort,types,supply-adapter,listing-query-sql,building-query-sql}.ts`（改） | 封顶与零偏移 |
| `src/components/frontend/listing/{EmptyOutOfRange,PagerCapNote}.tsx`、两个 `City*View.tsx`（改/新） | 如实文案 |
| `tests/bot-guard-*.test.ts`、`tests/public-page-cap.test.ts`（新） | 对应测试 |
| `DEPLOYMENT.md`、`payload-office-platform/.agent/frontend.md`（改） | env 与规则文档 |

---

### Task 0: 实施前核实（只读，产出证据文件）

**Files:**
- Create: `artifacts/verification/OPT-128/preflight.md`

**Interfaces:**
- Produces: 之后任务读取的四条事实（各引擎官方验真后缀、媒体真实路径、最大实例数、小程序页码用法）。

- [ ] **Step 1: 核对各搜索引擎官方「如何验证爬虫」**：对百度、Google、Bing、搜狗、360 各取官方文档，记录 rDNS 后缀与文档 URL。官方没有公布 rDNS 方法的引擎标记为 `none`。
- [ ] **Step 2: 确认媒体真实路径**：`rg -n "api/media/file" payload-office-platform/src`，并从一个房源详情页的 HTML 里取一张图片 URL，确认前缀就是 `/api/media/file/`。
- [ ] **Step 3: 核实 CloudRun 最大 / 最小实例数**：用 `queryCloudRun`（先 `auth(status)`）读服务 `sbh` 的扩缩容配置；读不到就如实写「未核实」。
- [ ] **Step 4: 核对小程序是否依赖第 50 页之后**：`rg -n "page" sbh-miniprogram --glob '*.ts' --glob '*.js'`，找出所有带 `page` 参数请求列表接口的位置，记录最大页码用法。
- [ ] **Step 5: 把四条结论连同来源写入 `preflight.md`**。验收：文件存在，且四条每条都有「结论 + 来源 / 命令」；任一条与设计文档假设不符则**停下来告知用户**，不继续。

---

### Task 1: 纯函数基础件（可信 IP、路径分类、UA、限速器、配置）

**Files:**
- Create: `payload-office-platform/src/lib/api/trusted-client-ip.ts`、`src/lib/bot-guard/{path-class,user-agent,limiter,config}.ts`
- Modify: `payload-office-platform/src/app/api/mini/v1/rate-limit-state.ts:29-41`（`resolveMiniTrustedClientIp` 改为调用共享函数，对外返回形状不变）
- Test: `tests/bot-guard-client-ip.test.ts`、`bot-guard-path-class.test.ts`、`bot-guard-user-agent.test.ts`、`bot-guard-limiter.test.ts`、`bot-guard-config.test.ts`

**Interfaces:**
- Produces（Task 2–4 依赖，签名必须一致）：
  - `trusted-client-ip.ts`：`type TrustedIpResult = Readonly<{ ok: true; ip: string }> | Readonly<{ ok: false; reason: 'bad_hops' | 'no_header' | 'bad_chain'; chainLength: number }>`；`resolveTrustedClientIp(xForwardedFor: string | null, trustedProxyHops: number | null): TrustedIpResult`
  - `path-class.ts`：`type GuardClass = 'page' | 'page-prefetch' | 'sitemap' | 'media' | 'mini-read' | 'exempt'`；`classifyPath(input: Readonly<{ method: string; pathname: string; isPrefetch: boolean }>): GuardClass`；`readIsPrefetch(get: (name: string) => string | null): boolean`
  - `user-agent.ts`：`type UaVerdict = Readonly<{ deny: boolean; rule: string | null; family: string }>`；`classifyUserAgent(ua: string | null): UaVerdict`
  - `limiter.ts`：`type ClassLimits = Readonly<{ burst: number; perMinute: number; perHour: number }>`；`type LimitDecision = Readonly<{ allowed: true }> | Readonly<{ allowed: false; retryAfterSeconds: number; window: 'burst' | 'hour' }>`；`createLimiter(opts: Readonly<{ now: () => number; maxKeys: number }>): Readonly<{ check(key: string, limits: ClassLimits): LimitDecision; size(): number }>`
  - `config.ts`：`type BotGuardMode = 'off' | 'observe' | 'enforce'`；`type BotGuardConfig = Readonly<{ mode: BotGuardMode; trustedProxyHops: number | null; allowIps: ReadonlySet<string>; logKey: string }>`；`readBotGuardConfig(env: Readonly<Record<string, string | undefined>>): BotGuardConfig`；常量 `CLASS_LIMITS: Readonly<Record<'page' | 'sitemap' | 'media' | 'mini-read', ClassLimits>>`、`ENFORCED_CLASSES: ReadonlySet<GuardClass>`（`page`、`sitemap`、`media`）、`LIMITER_MAX_KEYS = 50_000`、`UNRESOLVED_ENGINE_LIMIT_FACTOR = 10`

- [ ] **Step 1: 写失败测试 `bot-guard-client-ip.test.ts`**，断言：`('1.1.1.1, 2.2.2.2', 1)` → `ip '2.2.2.2'`；`('1.1.1.1, 2.2.2.2', 2)` → `'1.1.1.1'`；伪造首段 `('9.9.9.9, 1.1.1.1, 2.2.2.2', 2)` → `'1.1.1.1'`；链短于跳数 → `{ ok:false, reason:'bad_chain', chainLength:1 }`；`'1.1.1.1:443'`、`'::ffff:1.2.3.4'`、`'abc'` 任一项 → `bad_chain`；`null` → `no_header` 且 `chainLength 0`；跳数 `null / 0 / 6 / 1.5` → `bad_hops`；`'2001:db8::1'` 合法。
- [ ] **Step 2: 运行 `pnpm exec vitest run tests/bot-guard-client-ip.test.ts`**，预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现 `resolveTrustedClientIp`**：取链中倒数第 N 个，全链用 `node:net` 的 `isIP` 校验；逻辑从现有 `resolveMiniTrustedClientIp` 抽出，跳数合法范围同为整数 1–5。把 `resolveMiniTrustedClientIp` 改为包装它（`ok:true → { ok:true, clientIp }`，失败 → `{ ok:false }`）。
- [ ] **Step 4: 运行 client-ip 测试与既有小程序限流测试**：`pnpm exec vitest run tests/bot-guard-client-ip.test.ts` 与 `rg -l "resolveMiniTrustedClientIp" tests` 列出的全部文件；预期全 PASS。
- [ ] **Step 5: 写失败测试 `bot-guard-path-class.test.ts`**，用表驱动断言：`GET /sitemap.xml`、`/sitemaps/shanghai/listings/1.xml` → `sitemap`；`GET /api/media/file/a.jpg` → `media`；`GET /api/mini/v1/listings`、`/api/mini/v1/buildings/xxx`、`/api/mini/v1/home` → `mini-read`；`/api/mini/v1/session`、`/api/mini/v1/favorites` → `exempt`；`/api/health`、`/api/inquiries`、`/admin`、`/admin/collections/listings`、`/_next/static/a.js`、`/robots.txt`、`/favicon.ico`、`/logo.png` → `exempt`；`/`、`/listings`、`/shanghai/listings/abc`、`/news/x`、`/search` → `page`；`POST /listings` → `exempt`；`HEAD /listings` → `page`；`OPTIONS /listings` → `exempt`；`isPrefetch:true` 的 `GET /listings` → `page-prefetch`（**不豁免**）。另加 `readIsPrefetch` 用例：`next-router-prefetch: 1`、`purpose: prefetch`、`sec-purpose: prefetch` 任一为真，其余为假。
- [ ] **Step 6: 实现 `classifyPath` 与 `readIsPrefetch`**；判定顺序固定为：方法 → 站点地图 → 媒体 → mini 读 → 其余 `/api`、`/_next`、`/admin`、`/robots.txt`、`/favicon.ico`、带文件扩展名的末段 → 剩余为 `page`。
- [ ] **Step 7: 写失败测试 `bot-guard-user-agent.test.ts`**，断言：`null`、`''`、`'   '` → `deny:true, rule:'empty'`；`python-requests/2.31`、`curl/8.4.0`、`Wget/1.21`、`Go-http-client/1.1`、`Java/17.0.1`、`Scrapy/2.11`、`node-fetch/1.0`、`axios/1.6`、`aiohttp/3.9`、`Mozilla/5.0 ... HeadlessChrome/120` → `deny:true`；真实 Chrome / Safari / `MicroMessenger` / `Chrome-Lighthouse` / `Baiduspider` / `Googlebot` UA → `deny:false`；大小写不敏感；10000 字符 UA 与含控制字符 UA 不抛错，`family` 只含 `[A-Za-z0-9._-]` 且长度 ≤ 24，无法提取时为 `'other'`。
- [ ] **Step 8: 实现 `classifyUserAgent`**；规则表 `DENY_UA_RULES` 作为导出常量（规则名 + 正则），`family` 取首个产品令牌。
- [ ] **Step 9: 写失败测试 `bot-guard-limiter.test.ts`**（注入可控时钟），断言：同键突发额度用尽后第 `burst+1` 次 `allowed:false, window:'burst'` 且 `retryAfterSeconds ≥ 1`；等待补充后恢复；小时预算用尽返回 `window:'hour'`，`retryAfterSeconds` 为到窗口结束的秒数；不同键与不同类别互不影响；**写入 `maxKeys+500` 个不同键后 `size() ≤ maxKeys`**；真人序列：`page` 限额下 40 分钟内每分钟 1 次共 40 次、以及一次 20 连发后停顿，全部 `allowed:true`。
- [ ] **Step 10: 实现 `createLimiter`**：令牌桶容量 `burst`、每秒补充 `perMinute/60`；另设固定 1 小时窗口计数；`Map` 命中即删后重插以近似 LRU，超限从最旧开始淘汰。
- [ ] **Step 11: 写失败测试 `bot-guard-config.test.ts`**，断言：`{NODE_ENV:'production'}` → `observe`；`{NODE_ENV:'development'}` → `off`；`BOT_GUARD_MODE='enforce'` 覆盖默认；`'bogus'` 回落默认；`BOT_GUARD_TRUSTED_PROXY_HOPS` 取 `'1'`→1，`'0'`/`'x'`/`'9'`→`null`；`BOT_GUARD_ALLOW_IPS='1.1.1.1, 2001:db8::1, nope'` → 集合只含两个合法 IP；`logKey` 取 `BOT_GUARD_LOG_KEY ?? PAYLOAD_SECRET ?? ''`；`CLASS_LIMITS` 数值与 Global Constraints 一致，`ENFORCED_CLASSES` 不含 `mini-read`。
- [ ] **Step 12: 实现 `config.ts`**。
- [ ] **Step 13: 运行 `pnpm exec vitest run tests/bot-guard-client-ip.test.ts tests/bot-guard-path-class.test.ts tests/bot-guard-user-agent.test.ts tests/bot-guard-limiter.test.ts tests/bot-guard-config.test.ts`**，预期全 PASS；再 `pnpm typecheck`，预期无报错。
- [ ] **Step 14: Commit**（用户同意后）：`git add` 上述新增与修改的具体路径，信息 `feat(bot-guard): 可信 IP、路径分类、UA 规则、限速器与配置纯函数 (OPT-128)`。

---

### Task 2: 搜索引擎验真

**Files:**
- Create: `payload-office-platform/src/lib/bot-guard/search-engine.ts`
- Test: `tests/bot-guard-search-engine.test.ts`

**Interfaces:**
- Consumes: Task 0 的 `preflight.md`（各引擎后缀与 `none` 标记）。
- Produces：`type EngineId = 'baidu' | 'google' | 'bing' | 'sogou' | 'so360'`；`claimedEngine(ua: string | null): EngineId | null`；`type SearchEngineVerdict = Readonly<{ kind: 'none' }> | Readonly<{ kind: 'verified' | 'spoofed' | 'unresolved'; engine: EngineId }>`；`type DnsDeps = Readonly<{ reverse(ip: string): Promise<readonly string[]>; resolve(host: string): Promise<readonly string[]>; now(): number }>`；`createSearchEngineVerifier(deps: DnsDeps): (ip: string, ua: string | null) => Promise<SearchEngineVerdict>`；`createNodeDnsDeps(timeoutMs: number): DnsDeps`（真实依赖，用 `node:dns/promises`，每次调用 1s 超时）。

- [ ] **Step 1: 写失败测试**（fake `DnsDeps`），断言：UA 不声称任何引擎 → `none` 且**不触发任何 DNS 调用**；`Baiduspider` UA + rDNS 主机以官方后缀结尾 + 正向解析含该 IP → `verified`；rDNS 为不相干域名 → `spoofed`；rDNS 通过但正向解析不含该 IP → `spoofed`；`reverse` 抛错或超时 → `unresolved`（**不抛出**）；Task 0 标记为 `none` 的引擎 → 恒为 `unresolved`；`verified` 缓存 24h（时钟前进 23h 不再调 DNS、25h 再调）、`spoofed` 缓存 10min；缓存条目超 5000 时淘汰最旧；同一 IP 并发两次只发一次 DNS。
- [ ] **Step 2: 运行 `pnpm exec vitest run tests/bot-guard-search-engine.test.ts`**，预期 FAIL。
- **最终实现备注（2026-11-16）**：`ENGINES` 终表为 baidu（`.baidu.com`/`.baidu.jp`，`forwardLenient`）、google（含 `.googleusercontent.com`）、bing（`.search.msn.com`）；sogou / so360 无官方 rDNS 方法，恒 `unresolved`。空 PTR 仅百度判 `unresolved`，谷歌 / 必应判 `spoofed`；IP 先规范化（IPv6 压缩、`::ffff:` 解包）；候选 PTR 主机名最多 3 个。详见 spec §5.4。
- [ ] **Step 3: 实现**：引擎表 `ENGINES` 的后缀**以 Task 0 结论为准**，并在注释里写官方文档 URL 与核对日期；`unresolved` 缓存 60 秒以免 DNS 风暴（我的取舍，写进注释）；并发合并用在飞 Promise 表。
- [ ] **Step 4: 运行测试**，预期 PASS；`pnpm typecheck` 无报错。
- [ ] **Step 5: Commit**（用户同意后）：`feat(bot-guard): 搜索引擎反向 DNS 验真与缓存 (OPT-128)`。

---

### Task 3: 日志与守卫编排

**Files:**
- Create: `payload-office-platform/src/lib/bot-guard/{log,guard}.ts`
- Test: `tests/bot-guard-log.test.ts`、`tests/bot-guard-guard.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出；Task 2 的 `SearchEngineVerdict`、`claimedEngine`。
- Produces：
  - `log.ts`：`type GuardDecisionKind = 'would_limit' | 'would_deny' | 'limited' | 'denied' | 'se_verified' | 'se_spoofed' | 'ip_unresolved' | 'guard_error'`；`type GuardLogEvent = Readonly<{ kind: GuardDecisionKind; mode: BotGuardMode; cls: GuardClass; rule: string | null; ip: string | null; uaFamily: string; xffChainLength: number | null }>`；`createGuardLogger(deps: Readonly<{ write(line: string): void; now(): number; hashIp(ip: string): string; summaryIntervalMs: number }>): Readonly<{ record(event: GuardLogEvent): void }>`
  - `guard.ts`：`type GuardInput = Readonly<{ method: string; pathname: string; headers: Readonly<{ userAgent: string | null; xForwardedFor: string | null; isPrefetch: boolean }> }>`；`type GuardAction = Readonly<{ action: 'allow' }> | Readonly<{ action: 'deny'; status: 403 }> | Readonly<{ action: 'limit'; status: 429; retryAfterSeconds: number }>`；`type GuardDeps = Readonly<{ config: BotGuardConfig; limiter: ReturnType<typeof createLimiter>; verifyEngine: (ip: string, ua: string | null) => Promise<SearchEngineVerdict>; logger: ReturnType<typeof createGuardLogger> }>`；`evaluateGuard(input: GuardInput, deps: GuardDeps): Promise<GuardAction>`

- [ ] **Step 1: 写失败测试 `bot-guard-log.test.ts`**，断言：`would_limit`、`limited`、`denied`、`would_deny`、`se_spoofed` 各写一行 JSON，字段齐全；`ip` 在行里只以 `hashIp` 的结果出现，**整行不含原始 IP**；`uaFamily` 原样来自事件；**行内不含任何路径或 query 字段**；`se_verified` 与 `ip_unresolved` 只计数不逐条写；`now()` 前进满 `summaryIntervalMs` 后下一次 `record` 追加一行汇总 JSON（含各 `kind`×`cls` 计数，以及 `xffChainLength` 分布 `{ '0': n, '1': n, '2': n, '3+': n }`），汇总后计数清零；`write` 抛错不向外传播。
- [ ] **Step 2: 运行并确认 FAIL，再实现 `createGuardLogger`**；再运行预期 PASS。
  - **最终实现备注**：每个 `kind:类别` 键每个窗口最多逐条写 20 行（`MAX_LINES_PER_KEY_PER_WINDOW`），超出只计数，汇总行带 `suppressed`；`ip_unresolved` / `se_verified` 只计数不逐条写。
- [ ] **Step 3: 写失败测试 `bot-guard-guard.test.ts`**（全注入 fake），断言：
  - 模式：`off` → `allow` 且 `limiter`、`verifyEngine`、`logger` 均未被调用；`observe` 下超限与脚本 UA → `allow` 且 logger 收到 `would_limit` / `would_deny`；`enforce` 下同样输入 → `limit(429, retryAfterSeconds≥1)` / `deny(403)`。
  - 分类：`exempt` 路径直接 `allow`；`mini-read` 在 `enforce` 下超限仍 `allow`（只记 `would_limit`）。
  - IP：`trustedProxyHops: null` 或链非法 → `allow` 且记 `ip_unresolved`（带 `xffChainLength`）；`allowIps` 命中 → `allow`。
  - 搜索引擎：`verified` → `allow` 且不进限速器；`spoofed` + 脚本 UA → `deny`；`unresolved` 的请求不因 UA 被拒，且限速用 `CLASS_LIMITS × 10`。
  - **健壮性**：`verifyEngine` 抛错、`limiter.check` 抛错、`logger.record` 抛错，`evaluateGuard` 都**不抛**，返回 `allow` 并记 `guard_error`。
  - 真人序列（同一 IP 40 分钟 40 个 `page` 请求）在 `enforce` 下全部 `allow`。
- [ ] **Step 4: 运行并确认 FAIL，再实现 `evaluateGuard`**：顺序为 mode off → 分类 → 可信 IP → `allowIps` → 搜索引擎验真（仅当 `claimedEngine` 非空）→ UA 规则 → 限速；模式转换（`observe` 把 `deny`/`limit` 改写为 `allow` + `would_*` 日志）集中在一个函数里；整体包 `try/catch`。
- [ ] **Step 5: 运行 `pnpm exec vitest run tests/bot-guard-log.test.ts tests/bot-guard-guard.test.ts`**，预期 PASS；`pnpm typecheck` 无报错。
- [ ] **Step 6: Commit**（用户同意后）：`feat(bot-guard): 守卫编排、模式开关与结构化日志 (OPT-128)`。

---

### Task 4: proxy 接线、运行时单例与文档

**Files:**
- Create: `payload-office-platform/src/lib/bot-guard/runtime.ts`
- Modify: `payload-office-platform/src/proxy.ts`
- Modify: `DEPLOYMENT.md`（新增「爬虫守卫」一节，列 `BOT_GUARD_MODE`、`BOT_GUARD_TRUSTED_PROXY_HOPS`、`BOT_GUARD_ALLOW_IPS`、`BOT_GUARD_LOG_KEY` 及切换与回滚方式）
- Test: `tests/bot-guard-proxy-contract.test.ts`

**Interfaces:**
- Consumes: Task 1–3 全部。
- Produces：`runBotGuard(request: NextRequest): Promise<NextResponse | null>`（`null` 表示放行）；模块级单例按 `process.env` 惰性构建一次（配置、限速器、验真器、日志器，真实依赖为 `createNodeDnsDeps(1000)`、`console.info`、`hashIp` 用 `node:crypto` 的 HMAC-SHA256 取前 12 位十六进制）。

- [ ] **Step 1: 写失败的契约测试 `bot-guard-proxy-contract.test.ts`**（读 `src/proxy.ts` 源码文本），断言（只针对 `config.matcher` 数组的源文本，不扫注释）：仍含 `api$|api/|_next/` 的负向前瞻；含 `'/api/mini/v1/:path*'` 与 `'/api/media/file/:path*'`；**不含** `'/api/:path*'`、`/api/health`、`/admin`；`proxy` 函数声明为 `async`；源码里先调用 `resolveCanonicalRedirect` 再调用 `runBotGuard`（以两个调用在文本中的先后位置断言）。
- [ ] **Step 2: 运行并确认 FAIL**。
- [ ] **Step 3: 实现 `runtime.ts` 与改写 `proxy.ts`**：先做主域名 301（命中即返回），再 `await runBotGuard(request)`；`runBotGuard` 内部从 `request.headers` 取 `user-agent`、`x-forwarded-for`，用 `readIsPrefetch` 判预取，把 `GuardAction` 转为响应（`429` 带 `Retry-After`，`403`，均 `text/plain; charset=utf-8` + `Cache-Control: no-store`，正文为简短中文且不含规则名），`allow` 返回 `null`。matcher 改为 `['/((?!api$|api/|_next/).*)', '/api/mini/v1/:path*', '/api/media/file/:path*']`。
- [ ] **Step 4: 变异验证**：临时把 matcher 里的 `'/api/mini/v1/:path*'` 删掉，确认契约测试变红；再还原。
- [ ] **Step 5: 在 `DEPLOYMENT.md` 补文档**，并写清「合并即上线，生产默认 `observe`，切 `enforce` 的门槛见 OPT-128 §6」（Task 7 后补为四项：第 4 项为客户端 IP 来源核对，见 spec §6；另注明 Playwright / HeadlessChrome UA 在 `enforce` 下 403）。
  - **Task 4 备注**：预取请求不豁免，由 `readIsPrefetch` 判定后随 `isPrefetch` 传入守卫，归 `page-prefetch` 类别计桶。
- [ ] **Step 6: 运行 `pnpm exec vitest run tests/bot-guard-proxy-contract.test.ts tests/canonical-host.test.ts`**，预期 PASS；跑 `pnpm typecheck && pnpm lint`，预期无报错。
- [ ] **Step 7: Commit**（用户同意后）：`feat(bot-guard): proxy 接线、运行时单例与部署文档 (OPT-128)`。

---

### Task 5: 页码封顶（领域层）

**Files:**
- Create: `payload-office-platform/src/domain/public-catalog/page-cap.ts`
- Modify: `src/domain/public-catalog/types.ts:149`（`Pagination` 增加必填字段 `capped: boolean`）、`stable-sort.ts:250-287`（`paginate`、`buildPagination`）、`supply-adapter.ts:1193`（楼盘 `totalPages`）、`listing-query-sql.ts:168-169`、`building-query-sql.ts`（`LIMIT … OFFSET …` 处）、`facade.ts`（把 `findBuildingPageSelection` 结果映射为楼盘列表分页处，约 `578-705` 行，补 `capped`）
- Test: `tests/public-page-cap.test.ts`（既有分页 / 楼盘分页测试按类型报错处补字段）

**Interfaces:**
- Produces：`MAX_PUBLIC_PAGE = 50`（`as const`）；`capTotalPages(realTotalPages: number): number`（`min(real, 50)`）；`isCapped(realTotalPages: number): boolean`（`real > 50`）。`Pagination.capped` 的语义：真实总页数超过上限。

- [ ] **Step 1: 写失败测试 `public-page-cap.test.ts`**，断言：`capTotalPages(10)=10`、`(50)=50`、`(51)=50`、`(1460)=50`；`isCapped(50)=false`、`isCapped(51)=true`；`buildPagination(totalDocs=35000, page=1, 24)` → `totalPages 50, capped true, hasNextPage true`；`buildPagination(35000, 50, 24)` → `hasNextPage false`；`buildPagination(35000, 51, 24)` → `page 51, totalPages 50`（页码不钳制，保持越界可判定）；`buildPagination(480, 3, 24)` → `totalPages 20, capped false`（行为与现状一致）；`buildListingPageQuery` 在 `page=51` 时绑定的 limit 与 offset 均为 0（用 `query.values` 断言不含 `(51-1)*24 = 1200`），`page=50` 时 offset 为 `49*24`；楼盘页查询同样断言。
- [ ] **Step 2: 运行 `pnpm exec vitest run tests/public-page-cap.test.ts`**，预期 FAIL。
- [ ] **Step 3: 实现 `page-cap.ts`**，并让 `buildPagination`、`paginate`、`supply-adapter.ts:1193`、`facade.ts` 的楼盘映射都改用 `capTotalPages` 与 `isCapped`；`paginate` 的内存切片在 `page > MAX_PUBLIC_PAGE` 时返回空数组；两处 SQL 在 `input.page > MAX_PUBLIC_PAGE` 时 limit、offset 都绑定 0，**计数子查询保持不变**（越界空态要靠 `totalDocs > 0` 判定）。
- [ ] **Step 4: 修编译**：给 `Pagination` 加必填 `capped` 后 `pnpm typecheck` 会列出全部构造点，逐个补齐，不用可选字段规避。
- [ ] **Step 5: 运行 `pnpm exec vitest run tests/public-page-cap.test.ts` 与涉及 `buildPagination`、`paginate`、楼盘列表的既有测试**（`rg -l "buildPagination|paginate\\(|findBuildingPageSelection" tests`），预期全 PASS。
- [ ] **Step 6: Commit**（用户同意后）：`feat(public-catalog): 公开列表可翻页数封顶 50 并避免越界偏移扫描 (OPT-128)`。

---

### Task 6: 页码封顶（界面文案）与小程序核对

**Files:**
- Create: `payload-office-platform/src/components/frontend/listing/PagerCapNote.tsx`
- Modify: `EmptyOutOfRange.tsx`（新增**必填** prop `capped: boolean`）、`src/components/frontend/city/CityListingsView.tsx:246,440,519`、`CityBuildingsView.tsx:240,303,447`；`rg -n "<ListPager|<Pagination|EmptyOutOfRange" src` 找到的其它分页点按同口径处理
- Modify: `payload-office-platform/.agent/frontend.md`（「列表页」一节补页码封顶规则与文案口径）
- Test: 沿用 `rg -l "EmptyOutOfRange" tests` 找到的既有测试并扩展；新增 `tests/pager-cap-note.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `Pagination.capped`、`MAX_PUBLIC_PAGE`。
- Produces：`PagerCapNote(props: Readonly<{ capped: boolean }>): React.JSX.Element | null`（`capped` 为假返回 `null`）。`EmptyOutOfRange` 的 `capped` 为真时：标题「结果较多，仅展示前 {totalPages} 页，第 {page} 页不开放」，说明「请增加筛选条件缩小范围」，主按钮「去第 {totalPages} 页」；为假时保持现有文案不变。

- [ ] **Step 1: 写失败测试**，断言：`EmptyOutOfRange` 在 `capped:false` 时输出与现状逐字一致；`capped:true` 时包含「请增加筛选条件」且**不含**「只有 50 页」；`PagerCapNote capped:true` 输出含「仅显示前 50 页」，`capped:false` 返回 `null`；两个 `City*View` 源码在调用 `EmptyOutOfRange` 时都传了 `capped`（沿用仓库的源码文本断言写法）。
- [ ] **Step 2: 运行并确认 FAIL，再实现**；`capped` 作为必填 prop，不给默认值（`.agent/frontend.md`：语境相关文案一律必填）。`PagerCapNote` 渲染在两个视图里 `ListPager` 之后，只读 `pagination.capped`。
- [ ] **Step 3: 核对小程序**：按 Task 0 Step 4 的结论确认无依赖第 50 页之后的用法；若有，**停下来告知用户**。
- [ ] **Step 4: 在 `.agent/frontend.md` 补规则**（含「`parsePage` 不得直接收紧、封顶只在分页元数据层」的理由）。
- [ ] **Step 5: 运行相关测试，再 `pnpm typecheck && pnpm lint`**，预期无报错。
- [ ] **Step 6: Commit**（用户同意后）：`feat(frontend): 页码封顶时越界空态与分页提示如实说明 (OPT-128)`。

---

### Task 7: 本地实证与浏览器验证

**Files:**
- Create: `artifacts/verification/OPT-128/`（日志、截图、结论 `README.md`）

**Interfaces:** 无新代码。依赖 Task 1–6 全部完成。

- [ ] **Step 1: 环境等价确认**：`ls payload-office-platform/.env.production*`，**若存在 `.env.production.local` 先停下**——它是生产凭据，`next start` 会直连生产库；改用独立 PG 库与专用 `.env.local`，并用 `PORT=3721` 避开 3717；先 `pnpm exec payload migrate`，再 `pnpm seed`。
- [ ] **Step 2: 全量预检**：`pnpm generate:types && pnpm payload generate:importmap && pnpm typecheck && pnpm lint && pnpm test && pnpm build`，预期全部通过。
- [ ] **Step 3: `observe` 验证**：`BOT_GUARD_MODE=observe BOT_GUARD_TRUSTED_PROXY_HOPS=1 PORT=3721 pnpm start`；带头 `x-forwarded-for: 203.0.113.9` 循环请求 `/listings` 40 次，预期**全部 200**，日志出现 `would_limit`；`curl` 默认 UA 请求得 200 且日志出现 `would_deny`；整份日志 `grep -c "203.0.113.9"` 必须为 0。
- [ ] **Step 4: `enforce` 验证**：改 `BOT_GUARD_MODE=enforce` 重启；同样 40 次循环预期出现 `429` 且带 `Retry-After`；`curl` 默认 UA 得 `403`；伪造 `Googlebot` UA（IP 为 203.0.113.9，rDNS 不匹配）按普通客户端处理；`/api/health` 连续请求 100 次**全部 200**；`/admin` 登录页可正常打开。
- [ ] **Step 5: 浏览器走查**（`mcp__Claude_Browser__*`）：`enforce` 下正常浏览首页 → 列表 → 详情 → 搜索，翻到第 3 页，均不被拦；`/listings?page=51` 显示越界空态且文案如实；`?page=abc` 显示第 1 页；对真实总页数 ≤ 50 的筛选，页面与改动前一致。截图存入证据目录。
- [ ] **Step 6: 验不到的明说**：容器内 DNS 验真链路、真实网关给出的 IP 头形态、最大实例数，只能在生产 `observe` 期验证，写进 `README.md` 的「未验证」一节，**不得用「测试全绿」顶替**。
- [ ] **Step 7: Commit**（用户同意后）：`docs(opt-128): 本地验证证据 (OPT-128)`。

---

### Task 8: 上线与观察期（运维，需用户在场）

**Files:** 无代码改动。

- [ ] **Step 1: 合并前确认**：通知用户「合并 = 生产以 `observe` 上线」，得到明确同意再开 PR 与合并；PR 走 `.github/workflows/quality.yml` 全部通过。
- [ ] **Step 2: 观察期 ≥ 7 天**：用 `queryLogs` 读 CloudRun 日志，核对三道门槛：`ip_unresolved` 占比 < 1% 且 `xffChainLength` 恒定（据此确定 `BOT_GUARD_TRUSTED_PROXY_HOPS`）；至少一家真实引擎出现 `se_verified`；`would_limit` 里无明显真人；并据此校准 `CLASS_LIMITS`（若调整，走一次小改动 + 测试）。
- [ ] **Step 3: 切 `enforce`**：在控制台设置 `BOT_GUARD_TRUSTED_PROXY_HOPS` 与 `BOT_GUARD_MODE=enforce`，盯 24 小时；异常即改回 `observe`。
- [ ] **Step 4: 记录结果**：在 `OPT-128-anti-scraping-guard.md` 末尾追加「上线记录」（日期、跳数取值、阈值是否调整、观察期结论）。

---

## Self-Review 记录

- **Spec 覆盖**：§5.1→T4；§5.2、§5.3、§5.6→T1；§5.4→T2；§5.5→T1（限速器与常量）、T3（×10）；§5.7 页码封顶→T5、T6，站点地图不加鉴权→无需改动，`mini-read` 一期仅观察→T1 的 `ENFORCED_CLASSES` + T3 断言；§5.8→T3；§5.9→T1、T4；§6→T8；§7→各任务测试与 T7；§9 文档→T4、T6；§11 核实事项→T0。无缺口。
- **类型一致**：`GuardClass`、`ClassLimits`、`LimitDecision`、`BotGuardConfig`、`SearchEngineVerdict`、`GuardAction`、`Pagination.capped` 在各任务的 Interfaces 与使用处同名同形。
- **比例**：计划体量约为设计文档的 1.5 倍，代码块仅有签名与断言清单，无函数体。
