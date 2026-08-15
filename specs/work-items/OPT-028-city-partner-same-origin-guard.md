# Task Packet：OPT-028 城市合伙人接口的同源守卫钉死站点域名

> 状态：待评审（方案未定）
> 创建日期：2026-08-16
> 发现方式：OPT-027 给 CI 加了多城市开启态的 e2e 步骤后，该缺陷第一次暴露

## 1. 现象

`multi-city-forms.spec.ts` 的「City Partner stages persist Hangzhou」用例在 CI 上失败：浏览器控制台 `Failed to load resource: the server responded with a status of 403 (Forbidden)`，表单提交被拒，因而进不到第二步「补充合作信息（可选）」。

该用例已标 `test.fixme` 并指向本工作项，不阻断闸门。

## 2. 根因

两个公开表单端点的同源守卫写法不一致：

```ts
// src/app/api/city-partner-applications/request-guards.ts:83
// 把请求 origin 钉死在配置的站点域名上
export function isSameOrigin(req: Request, expectedOrigin = siteConfig.siteOrigin): boolean {
  const suppliedOrigin = new URL(origin)
  const expected = new URL(expectedOrigin)
  const suppliedHost = new URL(`${expected.protocol}//${host}`)
  return suppliedOrigin.origin === expected.origin && suppliedHost.host === expected.host
}

// src/app/api/inquiries/route.ts:81
// 只校验请求自身的 origin 与 host 是否自洽，与部署域名无关
function isSameOrigin(req: Request): boolean {
  if (!origin || !host) return true   // 同源请求可能不带 Origin
  return new URL(origin).host === host
}
```

`siteConfig.siteOrigin` 来自 `NEXT_PUBLIC_SITE_URL`。在 CI 里该值必须是线上 https 域名（`lib/runtime/config-guard.ts` 的生产 fail-closed 要求：非 https 或 localhost 即拒启动），而浏览器实际访问 `http://localhost:3717` —— 两者恒不相等，于是 403。

## 3. 影响范围

不只是 CI。**任何「配置的站点域名」与「实际服务域名」不一致的环境都会让城市合伙人表单全量 403**：

- 预览 / 演示环境
- 自定义域名或多域名接入
- 域名迁移期（新域名已解析、`NEXT_PUBLIC_SITE_URL` 尚未更新）

生产当前不受影响，因为两者恰好一致。`/api/inquiries`（委托找房）与 `/api/supply-submissions`（投放房源）不受影响。

## 4. 待决策：哪种写法才是想要的

这是安全守卫，改动前需要明确意图，**不要直接抄另一边了事**：

| 方案 | 含义 | 代价 |
|---|---|---|
| A. 改成与 `inquiries` 一致（origin 与 host 自洽） | 只防跨站提交，与部署域名解耦 | 失去「锁定站点域名」这一层；需确认当初加它是否有特定威胁模型 |
| B. 维持严格，统一把 `inquiries` 也收严 | 防护更强 | CI / 预览环境需要单独放行机制（如允许 `PLAYWRIGHT_BASE_URL` 或显式白名单） |
| C. 严格 + 环境白名单 | 生产严格、非生产可配 | 引入配置项，需防止白名单误开到生产 |

选 A 或 B 都要**同时统一三个公开端点**（inquiries / supply-submissions / city-partner-applications），否则同类接口三种行为的问题依然存在。

## 5. 验证方式

修复后移除 `multi-city-forms.spec.ts` 里的 `test.fixme`，由 `quality.yml` 的 `Run multi-city E2E (routing enabled)` 步骤验证。

注意该用例只在 `MULTI_CITY_ROUTING_ENABLED=true` 时执行。

## 6. 非目标

- 不在本工作项里开启生产的多城市路由（产品决定：短期不开）
- 不改动表单 UI 与文案
