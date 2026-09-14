# OPT-098 走查证据（2026-09-14）

## 1. 动手前的线上事实（CloudBase MCP + DoH + curl）

- `queryGateway listCustomDomains`：`shangban.cc` 已绑（CreateTime 2026-08-27 19:40，CertId `aKj4riGU`，Status SUCCESS），路由 `/ → CBR sbh` CreateTime **2026-09-14 11:35:53**（不是本工作项做的）。
- `ssl DescribeCertificates SearchKey=shangban.cc`：1 张，TrustAsia C1 DV Free，SAN `shangban.cc` + `www.shangban.cc`，`CertEndTime 2026-11-25`，`AutoRenewFlag 0`。
- DoH（dns.alidns.com）：`shangban.cc` CNAME `shangban.cc.tcbaccess.tencentcloudbase.com`；`www.shangban.cc` 同；目标 A `124.223.146.214 / 124.223.148.238`。
- `curl -sI https://shangban.cc/` → 200，`server: tcbgw`，`strict-transport-security: max-age=63072000; includeSubDomains; preload`；`https://www.shangban.cc/` → curl exit 000（TLS 握手失败，网关未绑 www）；`http://shangban.cc/` → 200。
- `https://shangban.cc/shanghai` 的 `<link rel="canonical">` = `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/shanghai`（Dockerfile 写死的旧值）。
- Server Actions 同源判定探针（POST `/admin/login`，`Next-Action: 00deadbeef`）：
  - `Origin: https://shangban.cc` → 404 `Server action not found.`（过了同源判定，action id 不存在）
  - `Origin: https://evil.example` → 500（同源判定拒绝）
  - 结论：网关给容器的有效主机（`x-forwarded-host` ?? `host`）就是 `shangban.cc`。
- `dnspod DescribeRecordList` → `you are not authorized`（当前登录态没有 DNSPod 权限，DNS 只能 DoH 复核）。

## 2. 基础设施动作（MCP）

| 调用 | 结果 |
|---|---|
| `manageGateway bindCustomDomain domain=www.shangban.cc certificateId=aKj4riGU accessType=DIRECT` | `success`，`OwnershipVerification: null` |
| `manageGateway createRoute domain=www.shangban.cc path=/ CBR sbh auth=false` | `success`，accessUrl `https://www.shangban.cc/` |

## 3. 本地（worktree `E:\wt-098`，`next dev -p 3731`，库 `sbh_dev_098` 已 `payload migrate` 到 `20260912_144311_opt_096_building_form`）

```
1. Host: www.shangban.cc  GET /shanghai/listings?page=2     → 301  Location: http://localhost:3731/shanghai/listings?page=2
2. Host: sbh-286300-10-1253925058.sh.run.tcloudbase.com  GET /admin/login → 301  Location: http://localhost:3731/admin/login
3. Host: localhost:3731 + X-Forwarded-Host: www.shangban.cc  GET /shanghai → 301  Location: http://localhost:3731/shanghai
4. Host: localhost:3731  GET /shanghai                        → 200（迁移前是 500：listings_building_form 不存在，环境落后，与本改动无关）
5. Host: www.shangban.cc  GET /api/health                     → 200（不跳）
6. Host: www.shangban.cc  GET /_next/static/chunks/x.js       → 404（不跳，走静态资源正常 404）
7. Host: www.shangban.cc  GET /apix                           → 301（/apix 不是 /api 前缀，照跳）
```

浏览器（Browser pane，`http://localhost:3731/shanghai`）：首页正常渲染，`document.title` = 「上海中高端商务办公租赁与写字楼选址平台 · 商办租赁」，`canonical` = `http://localhost:3731/shanghai`（本地 SITE_URL）。`/api/media/file/*` 500 是新 worktree 没有 `media/` 目录的既知现象，与本改动无关。

- `vitest run tests/canonical-host.test.ts`：12/12
- `pnpm typecheck`：0 错
- `eslint` 三个新文件：0 错

## 4. 线上（合并部署后补）

待填：`www` 301、旧域名页面 301、旧域名 `/api/health` 200、主域名 canonical / sitemap、后台登录。
