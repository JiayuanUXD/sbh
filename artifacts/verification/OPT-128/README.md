# OPT-128 本地验证证据

日期：2026-11-16　分支：`feat/opt-128-bot-guard-7c3a`　环境：本机独立 PG 库 `sbh_opt128`（localhost:5432，已 `payload migrate` + `pnpm seed`），**未连任何远程库**；`.env.local` 为 git 忽略文件，COS 变量留空，端口 3721。

## 1. 环境说明（含偏离 brief 的事实）

- `ls .env*` 仅有 `.env.example`，无 `.env.production*`。
- 生产模式 `next start` 会被 config-guard 拒启动（要求 https 站点 URL、COS）。沿用 CI e2e 的既有做法：启动时在**进程环境**里加 `CI=true`（`collectCosProductionViolations` 对 CI 跳过 COS）与 `NEXT_PUBLIC_SITE_URL=https://shangban.cc`，没有改任何代码。命令：

```bash
CI=true NEXT_PUBLIC_SITE_URL=https://shangban.cc BOT_GUARD_MODE=<observe|enforce> \
  BOT_GUARD_TRUSTED_PROXY_HOPS=1 PORT=3721 pnpm start
```

- 种子数据很小：在租房源 10 套、搜索「办公」9 条，**远不足 1200，真实封顶无法在本地触发**（见 §4）。

## 2. 全量预检（`preflight-*.log`）

| 项 | 结果 |
|---|---|
| `generate:types` + `generate:importmap` | 通过，工作树无变化 |
| `typecheck` | 通过 |
| `lint` | 0 error / 38 warning（既有告警） |
| `test`（vitest） | 543 个文件、7360 个用例全部通过 |
| `build` | 通过，`ƒ Proxy (Middleware)` 已出现 |

## 3. 守卫分阶段（curl，`x-forwarded-for` 手工指定，hops=1）

### observe（`server-observe.log`）

| 项 | 结果 |
|---|---|
| 同一 IP + 浏览器 UA 连续 40 次 `/listings` | 40 × 200（通过） |
| 日志出现 `would_limit`（rule=burst） | 10 条（通过） |
| 默认 UA `curl` | 200，日志 `would_deny`（rule=curl）（通过） |
| 日志里原始 IP `203.0.113.*` / UA 原文 `TestBrowser` | 均为 0；日志只有 12 位 HMAC 与 `uaFamily`（如 `Mozilla`、`curl`）（通过） |

### enforce（`server-enforce.log`）

| 项 | 结果 |
|---|---|
| 同 IP 40 次 `/listings` | 30 × 200 + 10 × 429；429 带 `retry-after: 1`、`cache-control: no-store`（通过） |
| 默认 UA `curl` | 403（通过） |
| 伪造 `Googlebot` UA（rDNS 不匹配） | 记 `se_spoofed`，按普通客户端处理：新 IP 35 次 → 30×200 + 5×429（通过） |
| `/api/health` 100 次（同一 IP、浏览器 UA） | 100 × 200（通过） |
| `/admin/login` | 200（通过） |
| `/robots.txt` | 200（通过） |
| `/sitemap.xml` 同 IP 连续 8 次 | 200×5 后 429×3（sitemap 突发 5）（通过） |
| 日志中 `203.0.113.*`、`198.51.100.*` 原文 | 0（通过） |
| 日志里的决策类别 | `denied` 8、`limited` 23、`se_spoofed` 20（`limited` 明细少于实际 429 数，是日志限量的设计） |

附带证据：Playwright 自带 Chromium 的 UA 含 `HeadlessChrome`，在 enforce 下首页/列表一律 403（UA 规则按设计生效）；截图时改用普通浏览器 UA。

## 4. 页码封顶

| 项 | 结果 |
|---|---|
| `/listings?page=51`（真实总页数 1） | 200，越界空态「这套筛选只有 1 页，第 51 页不存在」，出口「去最后一页（第 1 页）/回第 1 页」，文案如实（`05-*.png`）（通过） |
| `/listings?page=abc`、`?page=0` | 回到第 1 页，列表与正常页一致（`06-*.png`）（通过） |
| `/shanghai/search?q=办公&tab=listings&page=2`、`page=51` | 同一越界空态（通过） |
| 封顶本身（真实总页数 > 50 时的「仅显示前 50 页」提示、最后一页出口指向第 50 页） | **未验证**：种子仅 10 套，达不到 1200 条，只有单测覆盖 |
| 总页数 ≤ 50 的筛选与改动前一致 | 列表、翻页区外观无异常（`02-*.png`、`06-*.png`）；未与改动前基线逐像素对比 |

## 5. 浏览器走查（enforce）

- Browser 工具（`mcp__Claude_Browser__*`）访问 `http://localhost:3721`：首页、`/listings`、`?page=51`、`?page=abc`、`/shanghai/search?...&page=2` 均正常渲染，未被拦。
- 截图用 Playwright 存盘（`01-home`、`02-listings`、`03-detail`、`04-search`、`05-listings-page51-out-of-range`、`06-listings-page-abc`、`07-admin-login`），全部 200。
- 「翻到第 2、3 页」：种子数据只有 1 页，做不到，只能看越界空态。

### 与 brief 预期不符的发现（如实记录）

1. **本地直连并非 `ip_unresolved`**。Next 在请求没有 `x-forwarded-for` 时会用 socket 地址填一个（`next/dist/server/base-server.js:577` 的 `??=`），守卫因此把本地所有无头请求当作同一个 IP `::1`（日志哈希与 `HMAC('::1')` 一致），**会被限速**，日志里也没有任何 `ip_unresolved`。
   推论：生产上若网关某条链路不带 XFF，容器看到的会是网关/内网 socket 地址而不是「缺头」，`ip_unresolved < 1%` 这个门槛**测不出这种情况**，表现为 `would_limit` 里某个哈希占比极高。上线 observe 期要看 `ip` 哈希的集中度，并与 `xffChainLength` 对照。
2. **预取独立成 `page-prefetch` 类**（burst 60 / 120 每分钟 / 1200 每小时），而不是 spec §5.2 写的「预取不计」。代码与测试一致（`tests/bot-guard-config.test.ts`），spec 文字未同步。实测：同一 IP 用 Playwright 不间隔连开 4 个页面（每页触发十余个预取）就吃到 429；每页之间等 8 秒则全部 200。真人快速连点也可能触发，属于需用 observe 日志校准的阈值项。
3. enforce 日志的 `limited` 条数少于实际 429 数，符合日志限量设计，统计限速次数要看每 5 分钟的汇总行，不能数明细行。

## 6. 未验证

- 容器内 DNS 反向验真链路：本地没有真实搜索引擎来源，只验到「伪造 UA → `se_spoofed` → 按普通客户端处理」；`se_verified` 与「未决」档（DNS 不可用）只能在生产 observe 期确认。
- 真实网关给出的 `x-forwarded-for` 形态（链长度、是否含内网跳）与 `BOT_GUARD_TRUSTED_PROXY_HOPS` 取值；上面第 1 条发现使这点更需要看数据。
- 最大实例数：有效阈值 = 每实例阈值 × 实例数，本地单进程，未涉及。
- 小程序路径（`wx.cloud.callContainer` 的来源 IP、`mini-read` 仅 observe 的日志区分）：本地未走小程序。
- 页码封顶在真实 > 50 页数据下的表现（见 §4）。
- 未在生产或类生产环境做任何验证。
