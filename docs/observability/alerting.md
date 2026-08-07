# 可观测性与告警契约（OPT-018）

本文档定义商办租赁平台的生产可观测性契约：采集什么指标、用什么阈值、什么条件触发告警、告警如何消费。告警系统接入时按此实现。

## 1. 指标分层

| 层级 | 指标 | 采集方式 | 用途 |
|---|---|---|---|
| 用户体验 | LCP / INP / CLS / TTFB / FCP | 客户端 web-vitals 库 -> collector -> dataLayer（GTM） | 真实用户体验性能 |
| 业务 SLI | inquiry_success_rate | `/api/observability/sli` 端点 | 咨询提交成功率 |
| 业务 SLI | inquiry_rate_limited_ips_current_window | `/api/observability/sli` 端点 | 被限流 IP 数（异常流量/攻击信号） |
| 业务 SLI | inquiry_submissions_24h | `/api/observability/sli` 端点 | 咨询提交绝对量 |
| 业务 SLI | inquiry_active_ips_current_window | `/api/observability/sli` 端点 | 当前窗口活跃 IP 数 |

## 2. 阈值（单一事实源：`src/lib/observability/thresholds.ts`）

### Web Vitals（Google 官方口径）

| 指标 | good | needs-improvement | poor | 单位 |
|---|---|---|---|---|
| LCP | ≤ 2500 | 2501–4000 | > 4000 | ms |
| INP | ≤ 200 | 201–500 | > 500 | ms |
| CLS | ≤ 0.1 | 0.11–0.25 | > 0.25 | 无单位 |
| TTFB | ≤ 800 | 801–1800 | > 1800 | ms |
| FCP | ≤ 1800 | 1801–3000 | > 3000 | ms |

### SLI

| 指标 | good | needs-improvement | poor | 方向 |
|---|---|---|---|---|
| inquiry_success_rate | ≥ 0.95 | 0.90–0.94 | < 0.90 | 越高越好 |
| inquiry_error_rate | ≤ 0.05 | 0.06–0.10 | > 0.10 | 越低越好 |

阈值变更必须改 `thresholds.ts`，文档与代码保持同步。

## 3. 采集链路

### Web Vitals（客户端）

```
浏览器 -> web-vitals 库(onLCP/onINP/onCLS/onTTFB/onFCP)
       -> handleVitalReport() 用 thresholds.ts 评级
       -> collector.track('web_vital', {metric, value, rating})
       -> dataLayer(GTM) / ConsoleAdapter(dev)
```

- 生产环境写入 `window.dataLayer`，由 GTM 转发到分析平台。
- 开发环境输出到 console。
- SSR 不采集（`AnalyticsInit` 的 `useEffect` 仅客户端执行）。
- 采集代码：`src/lib/frontend/analytics/web-vitals.ts`，集成于 `init.ts` 的 `AnalyticsInit`。

### SLI（服务端端点）

```
GET /api/observability/sli
  Header: x-observability-key: <OBSERVABILITY_API_KEY>
  -> computeSliSnapshot()
       countLeadsSince(24h)        // payload.count leads
       countRateLimitCurrentWindow // raw SQL 聚合 inquiry_rate_limit
       -> rateSli() 评级
  -> { ok, snapshot, generated_at }
```

- 鉴权 fail-closed：生产环境必须配 `OBSERVABILITY_API_KEY` 且请求头匹配，否则 403。
- 非生产环境未配 key 时放行（本地调试）。
- 不暴露 PII：仅聚合计数与比率。
- 纯函数 `computeSliSnapshot`（`src/lib/observability/sli.ts`）注入查询依赖，单测覆盖。

## 4. 告警规则

告警系统定时轮询 `/api/observability/sli`（建议 1 分钟一次），按下列规则触发。

| 告警名 | 条件 | 持续 | 严重度 | 说明 |
|---|---|---|---|---|
| InquirySuccessRatePoor | `inquiry_success_rate` rating = `poor` | 5 分钟 | P1 | 成功率 < 0.90 持续 5 分钟 |
| InquirySuccessRateDegraded | rating = `needs-improvement` | 15 分钟 | P2 | 成功率 0.90–0.94 持续 15 分钟 |
| RateLimitedIpsSpike | `inquiry_rate_limited_ips_current_window` > 50 | 3 分钟 | P2 | 限流 IP 异常增多，疑似攻击或脚本滥用 |
| SubmissionsDrop | `inquiry_submissions_24h` 较前 24h 下降 > 50% | 30 分钟 | P2 | 咨询量异常下跌，疑似前端/API 故障 |
| SliEndpointDown | `/api/observability/sli` 非 2xx | 2 分钟 | P1 | 端点不可用，告警链路本身故障 |

### Web Vitals 告警

Web Vitals 经 GTM 进入分析平台后，在分析平台侧按 p75 口径告警：

| 告警名 | 条件 | 持续 | 严重度 |
|---|---|---|---|
| LCPPoor | p75(LCP) > 4000ms | 1 小时 | P2 |
| INPPoor | p75(INP) > 500ms | 1 小时 | P2 |
| CLSPoor | p75(CLS) > 0.25 | 1 小时 | P2 |

> p75 口径：取窗口内 75 分位数，反映"大多数用户的较差体验"。

## 5. 告警抑制与恢复

- **抑制窗口**：同一告警触发后 15 分钟内不重复发送（避免风暴）。
- **恢复通知**：条件解除后发送一次 resolved 通知。
- **依赖告警**：`SliEndpointDown` 期间，SLI 类告警自动抑制（数据源不可信）。

## 6. 告警渠道（待接入）

当前未接入实际告警系统。接入时按下列优先级：

1. **P1**：电话/短信 + 即时通讯（企业微信/钉钉机器人）
2. **P2**：即时通讯 + 邮件

接入清单：
- [ ] 选定告警平台（CloudBase 监控 / 自建 Prometheus + Alertmanager / 第三方 APM）
- [ ] 配置轮询 `/api/observability/sli` 的定时任务
- [ ] 设置 `OBSERVABILITY_API_KEY` 环境变量并授予告警平台
- [ ] GTM 数据流接入分析平台后配置 Web Vitals p75 告警
- [ ] 告警通知到值班手机/群

## 7. 看板（待接入）

- **SLI 看板**：消费 `/api/observability/sli` 时序数据，展示成功率/限流 IP/提交量的趋势曲线与当前评级。
- **Web Vitals 看板**：在分析平台展示 LCP/INP/CLS/TTFB/FCP 的 p75 趋势与评级分布。

接入清单：
- [ ] SLI 时序存储（CloudBase CLS / 外部 TSDB）
- [ ] Web Vitals 数据流落库（GTM -> 分析平台）
- [ ] 看板页面搭建

## 8. Runbook（告警处置）

### InquirySuccessRatePoor / Degraded
1. 查看 `/api/observability/sli` 确认当前成功率。
2. 查 CloudRun 日志（`queryLogs`）过滤 inquiry 相关错误。
3. 排查 PG 连接、schema 校验失败、幂等冲突激增等。
4. 若限流 IP 同时激增，参见 RateLimitedIpsSpike。

### RateLimitedIpsSpike
1. 确认是否真实流量峰值（营销活动）或攻击脚本。
2. 攻击场景：限流已生效（fail-open 仅在 PG 故障时放行），评估是否需临时下调 `max` 或加 WAF 规则。
3. 营销场景：评估是否临时上调 `INQUIRY_RATE_LIMIT_CONFIG.max`。

### SliEndpointDown
1. 查 CloudRun 服务是否健康（`/api/health`）。
2. 查 PG 连接池是否耗尽。
3. 端点本身是告警链路依赖，需优先恢复。

### LCPPoor / INPPoor / CLSPoor
1. 在分析平台定位受影响页面/设备。
2. 排查首屏资源体积、第三方脚本、布局抖动。
3. 参考 C 端性能预算（LCP ≤2.5s、INP ≤200ms、CLS ≤0.1，见 `.agent/testing.md`）。

## 9. 相关文件

| 文件 | 作用 |
|---|---|
| `src/lib/observability/thresholds.ts` | 阈值与评级（单一事实源） |
| `src/lib/observability/sli.ts` | SLI 快照聚合纯函数 |
| `src/app/api/observability/sli/route.ts` | SLI 端点 |
| `src/lib/frontend/analytics/web-vitals.ts` | Web Vitals 客户端采集 |
| `src/lib/frontend/analytics/init.ts` | AnalyticsInit 集成 |
| `tests/observability-thresholds.test.ts` | 阈值评级测试 |
| `tests/observability-sli.test.ts` | SLI 聚合测试 |
| `tests/analytics-web-vitals.test.ts` | Web Vitals 采集测试 |
