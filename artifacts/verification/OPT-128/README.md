# OPT-128 本地验证证据

日期：2026-11-16　分支：`feat/opt-128-bot-guard-7c3a`　环境：本机独立 PG 库 `sbh_opt128`（localhost:5432，已 `payload migrate` + `pnpm seed`），**未连任何远程库**；`.env.local` 为 git 忽略文件，COS 变量留空，端口 3721。

## 接续复验（2026-11-16）

- 沿用 OPT-128 专用工作树。从本地种子库复制出独立验收库 `sbh_opt128_acceptance`，各加入 1,225 条合成房源和楼盘数据。以生产构建启动并禁用后台任务。以下 §1–6 保留首轮验证记录。
- 最终代码通过类型检查、ESLint（0 个错误、37 个既有告警）、Vitest（543 个文件、7,361 个用例）、迁移静态检查（0 个阻断、8 个既有告警）和生产构建。本机使用 Node 24，仓库 CI 要求 Node 22。
- 房源、楼盘和搜索在第 50 页均显示封顶提示，下一页不可点击。第 51 页显示筛选引导，点击返回入口能到第 50 页。非法页码回到第一页，真实仅一页的搜索仍显示原越界文案。[第 50 页](08-listings-cap-page50.png) · [第 51 页](09-listings-cap-page51.png)
- Chromium 在 `enforce` 下实测首页、房源列表第 1–3 页、详情、搜索和后台登录。以约 2 秒间隔操作时无页面异常与守卫拦截。验收库未导入首页视频，Payload 在两种模式下均对该资源返回 JSON 403。
- 本地小程序 HTTP 接口的房源和楼盘分别有 1,235 和 1,233 条结果。第 50 页各返回 24 条、`hasNextPage=false`，直查第 51 页返回空数组且保留请求页码。楼盘条数合计有房源和无房源两组。微信云容器和真机链路待验证。
- Next 默认在到达 Proxy 前移除预取头，导致浏览器翻页误触普通页面限速。保留预取头后，同一来源 40 次预取全部 200 且返回 RSC，随后 40 次普通页面请求得到 30 次 200 和 10 次 429，429 带 `Retry-After` 与 `Cache-Control: no-store`。极短时间内自动切换十多个页面可触发预取桶 429，页面导航仍可用。旧主机名 301 保留查询串，脚本 UA 返回 403，健康检查返回 200。[Next.js Proxy 的 RSC 请求说明](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#rsc-requests-and-rewrites)
- 最终构建在 `observe` 下对同一来源 40 次普通页面请求和脚本请求均返回 200，日志记录 `would_limit` 和 `would_deny`，且没有原始 IP。
- 汇总日志新增 `ip_resolved`，可结合 `ip_unresolved` 计算解析失败率。两种结果均计入链长度分布，逐条日志保持原有的隐私与数量约束。回归测试覆盖成功、失败、放行和不进入守卫的请求。
- CloudBase 只读服务详情查询因本地凭证不可用或权限不足失败，生产实例上下限、真实代理跳数、容器内搜索引擎验真及观察期尚未核实。

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
