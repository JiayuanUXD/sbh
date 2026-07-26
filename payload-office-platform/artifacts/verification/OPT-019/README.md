# OPT-019 收敛公开调试面与安全响应头 · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md` P2 两项
> 完成标准：删除示例路由；生产安全头具备自动测试与部署响应证据

## 审查发现

- **公开示例路由**：`src/app/my-route/route.ts` 是 Payload 模板自带示例，初始化 Payload 后返回固定文本，无鉴权/限流/业务用途，增加无谓 DB 初始化入口与公开攻击面。
- **缺少统一安全响应头**：`next.config.mjs` 只设 turbopack root 与 images 远程白名单，无 CSP、X-Frame-Options、Referrer-Policy、Permissions-Policy、HSTS 契约或自动测试。

## 修复内容

### 1. 删除示例路由 + 关闭 X-Powered-By

- 删除 `src/app/my-route/route.ts`（Payload 模板示例路由）。
- `next.config.ts` 设 `poweredByHeader: false`，不再暴露 `X-Powered-By: Next.js, Payload`。

### 2. 安全头纯函数（`src/lib/security-headers.ts`）

单一事实源，`next.config.ts` 与测试都引用，避免漂移：

| 导出 | 作用 |
| --- | --- |
| `buildSecurityHeaders(env)` | 按 isProduction 返回 header -> value 映射 |
| `toNextHeaderEntries(headers)` | 转成 NextConfig headers() 的 `{key,value}` 数组 |

头清单：

| 头 | 生产 | 非生产 | 值 |
| --- | --- | --- | --- |
| X-Content-Type-Options | ✅ | ✅ | nosniff |
| X-Frame-Options | ✅ | ✅ | DENY |
| Referrer-Policy | ✅ | ✅ | strict-origin-when-cross-origin |
| Permissions-Policy | ✅ | ✅ | camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=() |
| Strict-Transport-Security | ✅ | ❌ | max-age=63072000; includeSubDomains; preload |
| Content-Security-Policy | ✅ | ❌ | 见下 |

生产 CSP：
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

设计权衡：
- 保留 `'unsafe-inline'`/`'unsafe-eval'`：Payload admin bootstrap 内联脚本需要。未来可用 middleware 生成 per-request nonce 收紧（见待办）。
- HSTS 仅生产：非生产可能走 http，加 HSTS 会强制 https 破坏 dev。
- 非生产不加 CSP：避免 dev 工具/源码映射被 CSP 误拦。
- X-Frame-Options 与 CSP frame-ancestors 并存：兼容旧浏览器。

### 3. next.config.mjs -> next.config.ts

迁移为 TypeScript 以便 import 纯函数并获得类型检查：

```ts
async headers() {
  return [{ source: '/:path*', headers: toNextHeaderEntries(buildSecurityHeaders({ isProduction })) }]
}
```

- 对所有路由（`/:path*`）应用安全头。
- `isProduction` 由 `process.env.NODE_ENV === 'production'` 决定。
- 同步更新 `Dockerfile`（COPY next.config.ts）与 `DEPLOYMENT.md`。

## 测试证据

| 测试文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/security-headers.test.ts` | 6 | 生产含 HSTS+CSP+基础头、非生产不含 HSTS/CSP、CSP 关键指令、Permissions-Policy 能力、toNextHeaderEntries 转换 |

```
Test Files  105 passed (105)
     Tests  2001 passed (2001)
```

`pnpm typecheck` 通过，`pnpm lint` 0 error。

## 部署响应证据

用 tsx 加载 `next.config.ts` 验证运行时可正确解析（jiti 转译 + import 链）：

```
NODE_ENV=production pnpm exec tsx verify-next-config.tmp.mjs
source: /:path*
header_count: 10
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
  (Next/Payload 自动: Accept-CH / Vary / Critical-CH；X-Powered-By 已关闭)
```

证明：
- `next.config.ts` 能被运行时加载（jiti 转译 `./src/lib/security-headers` import 链成功）；
- 生产模式 `headers()` 返回全部 6 个安全头；
- `X-Powered-By` 已关闭。

## 不变量

- 安全头单一事实源：所有头定义在 `src/lib/security-headers.ts`，next.config 与测试引用同一函数。
- 生产 fail-closed：生产必含 HSTS + CSP；非生产不破坏 dev。
- `/my-route` 已删除，不再有公开示例路由。
- `X-Powered-By` 已关闭。

## 未完成（待办）

- [ ] CSP 用 middleware 生成 per-request nonce，移除 'unsafe-inline'/'unsafe-eval'（需评估 Payload admin 兼容性）。
- [ ] 生产部署后实测 CSP 不破坏 admin/C 端（CSP report 收集）。
