# Task Packet：OPT-098 主域名 shangban.cc 收口（网关补绑 www + canonical 切换 + 旧域名 301）

> 状态：**已实施，待合并**
> 创建日期：2026-09-14
> 来源：用户要求「把 shangban.cc 绑定到这个项目」

---

## 1. 一句话

生产站点的对外主域名从 CloudRun 默认域名切到 `https://shangban.cc`：网关补绑 `www`，构建期 `NEXT_PUBLIC_SITE_URL` 切到主域名（canonical / sitemap / OG 随之切换），`www` 与两个 CloudRun 默认域名的页面请求 301 到主域名。

## 2. 现场事实（2026-09-14 排查，未动手前）

| 项 | 状态 |
|---|---|
| 网关自定义域名 `shangban.cc` | **已绑**（2026-08-27，证书 `aKj4riGU`，TrustAsia DV 免费证，SAN 含 `www`，到期 **2026-11-25**，未开自动续期） |
| 网关路由 `shangban.cc / → CBR sbh` | **已挂**（2026-09-14 11:35，不是本工作项做的） |
| DNSPod 解析 | `shangban.cc` 与 `www.shangban.cc` 均 CNAME → `shangban.cc.tcbaccess.tencentcloudbase.com`（DoH 复核） |
| `https://shangban.cc/` | 200，首页正常 |
| `https://www.shangban.cc/` | **打不开**（网关没绑 www，TLS 握手失败） |
| 页面 canonical | 仍指向 `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/...`（Dockerfile 写死） |
| `http://shangban.cc/` | 200，不跳 https（生产已发 HSTS `max-age=63072000; includeSubDomains; preload`） |
| Server Actions 同源判定 | `Origin: https://shangban.cc` 通过（伪造 action id 得 404「Server action not found」），`Origin: https://evil.example` 得 500——说明网关给容器的有效主机就是 `shangban.cc`，后台在新域名可用 |
| 备案 | `沪ICP备2026037944号`（OPT-097 页脚展示） |

## 3. 设计裁定（2026-09-14 与用户确认）

| 问题 | 裁定 |
|---|---|
| 主域名 | **裸域 `shangban.cc`**；`www` 301 到裸域。备案按 shangban.cc 报的 |
| 旧默认域名 | **页面请求 301 到主域名**（搜索引擎已按旧域名收录，要把权重归一）；`/api/*` 不跳——CI 冒烟只打旧域名的 `/api/health`，且 API 调用方不该被重定向 |
| 归一在哪层做 | **应用层 `src/proxy.ts`**（Next 16 的 proxy，Node 运行时），不用 `next.config` 的 `redirects({has:host})`：后者只看 `Host` 头，而网关是否改写 `Host`、是否带 `x-forwarded-host` 文档没写；proxy 里按「`x-forwarded-host` ?? `host`」判，与 Next Server Actions 的同源判定同一口径，线上已证明该口径下主域名请求的有效主机是 `shangban.cc`，**不可能成环** |
| 名单 | 只对**显式列出**的旧主机做 301：`www.shangban.cc`、`sbh-286300-…sh.run.tcloudbase.com`、`sbh-sbh-…run.wxcloudrun.com`。名单外（localhost、CI、未知反代）一律放行 |
| http → https | **本项不做**。网关的 `x-forwarded-proto` 语义未验证（TLS 在网关终结，nginx-ingress 一类若未开 `use-forwarded-headers` 会对 https 请求也报 `http`，按它跳会成环）。HSTS preload 已让浏览器二次访问不走 http；Chrome 对手输地址默认 HTTPS-First。要做的话先在灰度上验一次 `x-forwarded-proto` 再加规则 |
| 证书续期 | 免费 DV 证 90 天、**未开自动续期**，2026-11-25 到期。记入 TODOS，到期前在 SSL 控制台重新申请并在网关两个域名上换绑 |

## 4. 做法

### 4.1 基础设施（已通过 CloudBase MCP 执行，2026-09-14）

| 动作 | 结果 |
|---|---|
| `manageGateway bindCustomDomain www.shangban.cc`（证书 `aKj4riGU`，DIRECT） | 成功，`OwnershipVerification: null`（不需要 TXT 验证） |
| `manageGateway createRoute www.shangban.cc / → CBR sbh` | 成功 |

DNS 不用动（www 早已 CNAME 到同一目标）。DNSPod 的 API 用当前登录态调不了（`dnspod:DescribeRecordList` 无权限），只能 DoH 复核。

### 4.2 代码

| 文件 | 改动 |
|---|---|
| `src/lib/frontend/canonical-host.ts`（新） | 纯函数 `resolveCanonicalRedirect`：有效主机 = `x-forwarded-host` 第一跳 ?? `host`（去端口、小写）；等于主域名 → 不跳；不在 `LEGACY_HOSTS` → 不跳；`/api`、`/_next` → 不跳；否则返回 `${siteOrigin}${pathname}${search}` |
| `src/proxy.ts`（新） | 接线：命中返回 `NextResponse.redirect(target, 301)`；`matcher: ['/((?!api$\|api/\|_next/).*)']` |
| `Dockerfile` | builder 与 runner 两处 `ENV NEXT_PUBLIC_SITE_URL=https://shangban.cc` |
| `.github/workflows/quality.yml` | `NEXT_PUBLIC_SITE_URL: https://shangban.cc`（E2E 的 baseURL 早已与之解耦） |
| `scripts/cloudrun-release.sh` | `SITE_URL` 默认值切到主域名（脚本冒烟会打页面路径，旧域名会得到 301 而非 200） |
| `.env.example` | 示例值同步 |
| `tests/canonical-host.test.ts`（新） | 纯函数 12 例（www / 两个旧域名 / 主域名不跳 / x-forwarded-host 优先 / localhost 放行 / api 与 _next 放行 / 名单守卫）+ 接线守卫（proxy.ts 存在且 matcher 排除 api、_next；Dockerfile 两处、quality.yml、release.sh 的站点 URL 都是主域名） |
| `CLAUDE.md`、`DEPLOYMENT.md`、`TODOS.md` | 域名事实 + 证书续期待办 |

**deploy.yml 不动**：冒烟与切流后验证打的是旧默认域名的 `/api/health`，在 `/api` 豁免下仍是 200；且默认域名不依赖 DNS，是最稳的探针。

### 4.3 不做

- 后台 / 会员 cookie 迁移：cookie 是 host-only，旧域名的登录态到新域名要重新登录，属预期。
- Umami 站点域名字段：埋点脚本没配 `data-domains`，域名字段只是展示，不影响采集。
- Payload `serverURL` / `cors` / `csrf`：仓库未配置，Payload 按请求推导；实测 REST 与 Server Actions 在新域名都正常。

## 5. 验收

| 项 | 判据 |
|---|---|
| 单测 | `tests/canonical-host.test.ts` 12/12 |
| 本地 | worktree 起 dev（:3729），`curl -H "Host: www.shangban.cc" localhost:3729/shanghai` → 301 `Location: http://localhost:3729/shanghai`；`Host: localhost:3729` → 200；`Host: www.shangban.cc` 打 `/api/health` → 200 |
| 线上（合并部署后） | `curl -sI https://www.shangban.cc/` → 301 `location: https://shangban.cc/`；旧域名页面 → 301；旧域名 `/api/health` → 200；`https://shangban.cc/shanghai` 的 `<link rel="canonical">` 为 `https://shangban.cc/shanghai`；`/sitemap.xml` 全部为主域名；后台 `/admin/login` 在主域名可登录 |

证据目录：`artifacts/verification/OPT-098/`。
