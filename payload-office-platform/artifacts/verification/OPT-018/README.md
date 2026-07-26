# OPT-018 生产可观测性与性能实测 · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md`
> 完成标准：Web Vitals 和关键业务 SLI 有真实采集、阈值、看板和告警证据

## 审查发现

生产环境缺少可观测性闭环：

- 无 Web Vitals 采集，真实用户体验性能（LCP/INP/CLS 等）不可见；
- 无业务 SLI 端点，咨询成功率/限流量等关键指标无法被看板/告警消费；
- 阈值散落或缺失，告警无统一事实源。

无法支撑生产故障发现与性能回归监控。

## 修复内容

### 1. 阈值与评级纯函数（`src/lib/observability/thresholds.ts`）

单一事实源，Web Vitals 与 SLI 阈值集中定义：

| 导出 | 作用 |
| --- | --- |
| `WEB_VITAL_THRESHOLDS` | LCP/INP/CLS/TTFB/FCP 的 good/needs-improvement 边界（Google 官方口径） |
| `SLI_THRESHOLDS` | inquiry_success_rate / inquiry_error_rate 阈值 |
| `rateWebVital(metric, value)` | 按阈值评级 -> good / needs-improvement / poor |
| `rateSli(metric, value)` | SLI 评级（支持越高越好/越低越好两个方向） |
| `SliSnapshot` | SLI 端点响应类型 |

### 2. Web Vitals 客户端采集（`src/lib/frontend/analytics/web-vitals.ts`）

复用 OPT-010 的 collector 流水线（脱敏/去重/队列/适配器）：

- `handleVitalReport(collector, name, value)`：校验指标名 -> 用 thresholds.ts 评级 -> `collector.track('web_vital', {metric, value, rating})`。纯函数（副作用仅为注入的 collector.track）。
- `initWebVitals(collector, lib?)`：动态 import web-vitals 库，注册 onLCP/onINP/onCLS/onTTFB/onFCP 回调；返回 stop 函数。
- 评级不依赖 web-vitals 库自带 rating，统一走 thresholds.ts。
- 集成于 `init.ts` 的 `AnalyticsInit`（`useEffect` 内启动，SSR 不触发）。
- `web_vital` 加入 `events.ts` 事件白名单（属性：metric/value/rating）。

### 3. SLI 聚合纯函数（`src/lib/observability/sli.ts`）

`computeSliSnapshot(deps)` 把"查 DB"与"算比率/评级"分离，查询通过 `SliQueryDeps` 注入：

- `inquiry_submissions_24h`：leads 表近 24h createdAt 计数；
- `inquiry_active_ips_current_window`：inquiry_rate_limit 当前窗口行数；
- `inquiry_rate_limited_ips_current_window`：其中 count > max 的行数；
- `inquiry_success_rate`：当前窗口 leads 成功数 / 限流总尝试数（clamp [0,1]）；
- `ratings.inquiry_success_rate`：good / needs-improvement / poor / unknown。

### 4. SLI 端点（`src/app/api/observability/sli/route.ts`）

```
GET /api/observability/sli
Header: x-observability-key: <OBSERVABILITY_API_KEY>
-> { ok, snapshot, generated_at }
```

- 鉴权 fail-closed：生产必须配 `OBSERVABILITY_API_KEY` 且请求头匹配，否则 403；非生产未配 key 时放行（本地调试）。
- `countLeadsSince` 走 `payload.count`，`countRateLimitCurrentWindow` 走 raw SQL 聚合 inquiry_rate_limit（当前窗口）。
- 不暴露 PII：仅聚合计数与比率。
- 安全响应头：`Cache-Control: no-store` + `X-Content-Type-Options: nosniff`。

### 5. 限流配置提取（`src/lib/rate-limit-config.ts`）

`INQUIRY_RATE_LIMIT_CONFIG` 从 inquiries route 提取到独立文件，供 SLI 端点复用 windowMs/max，避免两处定义漂移。

### 6. 告警契约文档（`docs/observability/alerting.md`）

定义：
- 指标分层（用户体验 / 业务 SLI）；
- 阈值表（引用 thresholds.ts）；
- 采集链路（Web Vitals -> dataLayer/GTM；SLI -> 端点轮询）；
- 告警规则（5 条 SLI 告警 + 3 条 Web Vitals p75 告警，含持续窗口与严重度）；
- 告警抑制/恢复策略；
- 待接入清单（告警平台、看板、通知渠道）；
- Runbook（告警处置流程）。

## 测试证据

| 测试文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/observability-thresholds.test.ts` | 33 | Web Vitals 各指标 good/ni/poor 边界、SLI 双向评级、常量完整性 |
| `tests/observability-sli.test.ts` | 5 | 无尝试 unknown、成功率 good/ni/poor、clamp 到 1 |
| `tests/analytics-web-vitals.test.ts` | 4 | handleVitalReport 评级与未知指标丢弃、initWebVitals 注册 5 个 on*/stop 后不 track |

```
Test Files  104 passed (104)
     Tests  1995 passed (1995)
```

`pnpm typecheck` 通过。

## 不变量

- 阈值单一事实源：所有评级走 `thresholds.ts`，文档与代码同步。
- SLI 端点 fail-closed 鉴权：生产未配 key 或 key 不匹配 -> 403。
- 不暴露 PII：SLI 仅聚合计数与比率；Web Vitals 仅 metric/value/rating。
- SLI 聚合是纯函数 + 注入依赖，不耦合 Payload/PG 实现，可单测。

## 依赖

- `web-vitals@^6.0.0`（客户端 LCP/INP/CLS/TTFB/FCP 采集）
- 复用 OPT-010 collector 流水线、OPT-017 inquiry_rate_limit 表与限流配置

## 未完成（待接入清单）

告警与看板平台接入属运维侧配置，契约与代码已就绪，见 `docs/observability/alerting.md` §6/§7：

- [ ] 告警平台选定与轮询任务配置
- [ ] Web Vitals 数据流落库（GTM -> 分析平台）
- [ ] SLI 时序存储与看板搭建
- [ ] 告警通知到值班手机/群
