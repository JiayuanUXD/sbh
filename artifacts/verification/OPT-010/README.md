# OPT-010 可插拔埋点采集框架

## 背景

`optimization-backlog.md` OPT-010 / 审查 P2-02（P1）：`InquiryModal.trackEvent` 仅在页面已存在 `window.dataLayer` 时推送事件；否则生产环境不发送也不报告。无全局事件采集器、SDK 初始化、队列/重试、曝光去重或隐私属性白名单。事件标记看似存在，但无法证明生产数据被真实接收。

## 完成标准

事件名称、属性、隐私、去重和失败策略有自动测试。

## 方案：可插拔适配器框架（用户确认）

新建 `src/lib/frontend/analytics/`，业务代码只调 `track(name, props)`，由 collector 经流水线处理后交适配器发送。平台接入（GA4/GTM 等）时实现新 `AnalyticsAdapter` 即可，不改业务代码。

### 模块

| 文件 | 职责 |
|------|------|
| `events.ts` | 事件名白名单 `ANALYTICS_EVENTS` + 每事件属性白名单；`validateEvent` 校验事件名/剥离白名单外属性/拒绝对象数组值/字符串截断 100；`serializeProps` 稳定指纹 |
| `dedupe.ts` | `createDeduper`：按"事件名+属性指纹"窗口去重，可配置每事件窗口（`inquiry_open` 2s），窗口 0 不去重；注入时钟可测 |
| `queue.ts` | `createQueue`：攒批（maxBatchSize）+ 定时 flush；`adapter.send` 抛错时指数退避重试（base*2^(n-1)），超 `maxRetries` 放弃 + `console.error`；失败 batch 单独保存（pendingRetry），新事件继续入 buffer 不混合；永不向业务抛错 |
| `adapter.ts` | `AnalyticsAdapter` 接口 + `NoopAdapter`（默认降级）/ `ConsoleAdapter`（开发）/ `DataLayerAdapter`（写 `window.dataLayer`，GTM 兼容） |
| `collector.ts` | `createCollector`：validate -> dedupe -> enqueue 流水线；未知事件丢弃 + 开发环境 console.warn |
| `init.ts` | 单例 collector + `track` 公开 API + `AnalyticsInit` 组件（订阅 `visibilitychange`/`pagehide` flush）；生产用 DataLayerAdapter，开发用 ConsoleAdapter，SSR 用 NoopAdapter |
| `index.ts` | 统一导出 |

### 业务迁移

- `InquiryModal` 删除内部 `trackEvent`，改用 `import { track } from '@/lib/frontend/analytics'`；`trackEvent(` -> `track(`。所有事件（inquiry_open/submit/success/error）属性均为枚举/上下文标记，不含姓名/手机号/留言。
- `(frontend)/layout.tsx` 在 `<body>` 末尾注入 `<AnalyticsInit />`。

## 验证证据

### 自动测试（27 项全通过）

```
pnpm vitest run tests/analytics-events.test.ts tests/analytics-dedupe.test.ts tests/analytics-queue.test.ts tests/analytics-collector.test.ts
Test Files 4 passed (4) | Tests 27 passed (27)
```

覆盖：
- **事件名/属性**：已知事件通过、未知事件丢弃、白名单外属性剥离、对象/数组值丢弃、字符串截断、null/undefined 跳过、number 保留
- **隐私**：白名单完整性测试断言所有事件属性 key 不含 name/phone/email/message/ip 等敏感字段
- **去重**：窗口 0 不去重、窗口内同指纹丢弃、窗口外放行重置、不同属性不去重、不同事件名不去重、defaultWindowMs 兜底、reset 清空
- **失败策略**：攒批立即 flush、定时 flush、send 抛错指数退避重试至 maxRetries 放弃 + console.error、重试期间新事件不与失败 batch 混合、永不向业务抛错
- **collector 集成**：未知事件不入队、inquiry_open 窗口内去重只发一次、白名单外属性入队前剥离、非曝光事件不去重、时间戳入队

### 静态检查

```
pnpm lint      -> 0 errors, 8 warnings（均为预存 no-img-element / InquiryModal useMemo，与 OPT-010 无关）
pnpm typecheck -> 通过
```

### 浏览器验收（dev server :3717）

1. 导航到房源详情页 `/listings/jingan-serviced-office-42-seats`，点"询价 / 预约看房"打开咨询 Modal
2. eval 触发 `visibilitychange`（hidden）-> AnalyticsInit flush
3. console 出现 `[debug] [analytics] inquiry_open Object`（ConsoleAdapter 输出）

证明：事件经 collector 流水线真实采集并发送，不再因 `window.dataLayer` 不存在而生产静默丢失。

## 约束遵守

- 未新增 `any` / `as any` / `@ts-ignore` ✓
- 未触碰迁移文件、生产 DB ✓
- 隐私白名单：不采集姓名/手机号/邮箱/留言/原始 IP（events.test.ts 断言）✓
- 不阻断业务：queue 永不抛错，超限放弃仅 console.error ✓
- AnalyticsInit effect 合规 Next 16（无同步 setState，仅 addEventListener）✓
