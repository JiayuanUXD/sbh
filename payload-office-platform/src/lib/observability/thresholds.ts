// 可观测性阈值与评级（OPT-018）。
//
// 纯函数：Web Vitals 与业务 SLI 的阈值定义 + 评级。
// 供前端 web-vitals 采集和服务端 SLI 端点共用，无副作用，易单测。
//
// 阈值来源：
// - Web Vitals：Google 官方 good/needs-improvement 边界（https://web.dev/articles/vitals）
// - SLI：询盘成功率 >= 95% 为 good，< 90% 为 poor；错误率反之。

/** Web Vitals 指标名 */
export type WebVitalMetric = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'

/** 评级 */
export type Rating = 'good' | 'needs-improvement' | 'poor'

/** 阈值：good 上界 / needs-improvement 上界（<= good 为 good，<= ni 为 needs-improvement，否则 poor） */
export type Threshold = { good: number; needsImprovement: number }

/**
 * Web Vitals 官方阈值（值 <= good 为 good，<= needsImprovement 为 needs-improvement，否则 poor）。
 * 单位：LCP/INP/TTFB/FCP 为 ms，CLS 无单位。
 */
export const WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, Threshold> = {
  LCP: { good: 2500, needsImprovement: 4000 },
  INP: { good: 200, needsImprovement: 500 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  TTFB: { good: 800, needsImprovement: 1800 },
  FCP: { good: 1800, needsImprovement: 3000 },
}

/** 业务 SLI 指标名 */
export type SliMetric = 'inquiry_success_rate' | 'inquiry_error_rate'

/** SLI 阈值：higherIsBetter=true 时 >= good 为 good；=false 时 <= good 为 good */
export type SliThreshold = { good: number; needsImprovement: number; higherIsBetter: boolean }

export const SLI_THRESHOLDS: Record<SliMetric, SliThreshold> = {
  inquiry_success_rate: { good: 0.95, needsImprovement: 0.9, higherIsBetter: true },
  inquiry_error_rate: { good: 0.05, needsImprovement: 0.1, higherIsBetter: false },
}

/** 评级 Web Vitals 指标 */
export function rateWebVital(metric: WebVitalMetric, value: number): Rating {
  const t = WEB_VITAL_THRESHOLDS[metric]
  if (value <= t.good) return 'good'
  if (value <= t.needsImprovement) return 'needs-improvement'
  return 'poor'
}

/** 评级业务 SLI（higherIsBetter 决定比较方向） */
export function rateSli(metric: SliMetric, value: number): Rating {
  const t = SLI_THRESHOLDS[metric]
  if (t.higherIsBetter) {
    if (value >= t.good) return 'good'
    if (value >= t.needsImprovement) return 'needs-improvement'
    return 'poor'
  }
  if (value <= t.good) return 'good'
  if (value <= t.needsImprovement) return 'needs-improvement'
  return 'poor'
}

/** SLI 端点返回的指标快照 */
export type SliSnapshot = {
  inquiry_submissions_24h: number
  inquiry_rate_limited_ips_current_window: number
  inquiry_active_ips_current_window: number
  /** 询盘成功率（24h）：成功提交 / (成功提交 + 当前窗口被限流 IP 数) 的代理值，无分母时为 null */
  inquiry_success_rate: number | null
  ratings: {
    inquiry_success_rate: Rating | 'unknown'
  }
}
