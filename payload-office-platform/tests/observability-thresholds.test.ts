import { describe, it, expect } from 'vitest'
import {
  rateWebVital,
  rateSli,
  WEB_VITAL_THRESHOLDS,
  SLI_THRESHOLDS,
  type WebVitalMetric,
  type SliMetric,
} from '../src/lib/observability/thresholds'

describe('rateWebVital', () => {
  const cases: Array<{ metric: WebVitalMetric; value: number; expected: 'good' | 'needs-improvement' | 'poor' }> = [
    // LCP ms: good<=2500, ni<=4000
    { metric: 'LCP', value: 0, expected: 'good' },
    { metric: 'LCP', value: 2500, expected: 'good' },
    { metric: 'LCP', value: 2501, expected: 'needs-improvement' },
    { metric: 'LCP', value: 4000, expected: 'needs-improvement' },
    { metric: 'LCP', value: 4001, expected: 'poor' },
    // INP ms: good<=200, ni<=500
    { metric: 'INP', value: 200, expected: 'good' },
    { metric: 'INP', value: 201, expected: 'needs-improvement' },
    { metric: 'INP', value: 500, expected: 'needs-improvement' },
    { metric: 'INP', value: 501, expected: 'poor' },
    // CLS 无单位: good<=0.1, ni<=0.25
    { metric: 'CLS', value: 0.1, expected: 'good' },
    { metric: 'CLS', value: 0.11, expected: 'needs-improvement' },
    { metric: 'CLS', value: 0.25, expected: 'needs-improvement' },
    { metric: 'CLS', value: 0.26, expected: 'poor' },
    // TTFB ms: good<=800, ni<=1800
    { metric: 'TTFB', value: 800, expected: 'good' },
    { metric: 'TTFB', value: 1800, expected: 'needs-improvement' },
    { metric: 'TTFB', value: 1801, expected: 'poor' },
    // FCP ms: good<=1800, ni<=3000
    { metric: 'FCP', value: 1800, expected: 'good' },
    { metric: 'FCP', value: 3000, expected: 'needs-improvement' },
    { metric: 'FCP', value: 3001, expected: 'poor' },
  ]

  for (const { metric, value, expected } of cases) {
    it(`${metric}=${value} -> ${expected}`, () => {
      expect(rateWebVital(metric, value)).toBe(expected)
    })
  }

  it('WEB_VITAL_THRESHOLDS 覆盖全部 5 个指标', () => {
    expect(Object.keys(WEB_VITAL_THRESHOLDS).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'])
  })
})

describe('rateSli', () => {
  const successCases: Array<{ value: number; expected: 'good' | 'needs-improvement' | 'poor' }> = [
    { value: 1.0, expected: 'good' },
    { value: 0.95, expected: 'good' },
    { value: 0.94, expected: 'needs-improvement' },
    { value: 0.9, expected: 'needs-improvement' },
    { value: 0.89, expected: 'poor' },
    { value: 0, expected: 'poor' },
  ]
  for (const { value, expected } of successCases) {
    it(`inquiry_success_rate=${value} -> ${expected}`, () => {
      expect(rateSli('inquiry_success_rate', value)).toBe(expected)
    })
  }

  const errorCases: Array<{ value: number; expected: 'good' | 'needs-improvement' | 'poor' }> = [
    { value: 0, expected: 'good' },
    { value: 0.05, expected: 'good' },
    { value: 0.06, expected: 'needs-improvement' },
    { value: 0.1, expected: 'needs-improvement' },
    { value: 0.11, expected: 'poor' },
    { value: 1.0, expected: 'poor' },
  ]
  for (const { value, expected } of errorCases) {
    it(`inquiry_error_rate=${value} -> ${expected}`, () => {
      expect(rateSli('inquiry_error_rate', value)).toBe(expected)
    })
  }

  it('SLI_THRESHOLDS 含两个指标', () => {
    expect(Object.keys(SLI_THRESHOLDS).sort()).toEqual(['inquiry_error_rate', 'inquiry_success_rate'])
  })
})
