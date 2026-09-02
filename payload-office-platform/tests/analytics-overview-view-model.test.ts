/**
 * `/api/overview` 响应解析与降级（OPT-065）
 *
 * 这层的价值全在**不丢卡**：服务端已按卡做失败隔离，客户端若把非成功的卡过滤掉，
 * 「指标查询炸了」和「指标压根没注册」在页面上就长得一模一样了，
 * 而这两件事的处置完全不同（前者报障，后者改配置）。
 */

import { describe, expect, it } from 'vitest'

import {
  cardStatusHint,
  formatAsOf,
  formatMetricValue,
  maxBucketValue,
  parseOverviewPayload,
  toCardView,
  type OverviewCardView,
} from '@/components/admin/analytics/overview-view-model'

function card(overrides: Partial<OverviewCardView> = {}): OverviewCardView {
  return {
    code: 'listings.total',
    label: '房源总数',
    unit: 'count',
    status: 'success',
    value: 12,
    buckets: [],
    drilldownUrl: null,
    error: null,
    ...overrides,
  }
}

describe('parseOverviewPayload', () => {
  it('解析完整响应并归一三个分组', () => {
    const parsed = parseOverviewPayload({
      ok: true,
      asOf: '2026-09-02T08:00:00.000Z',
      cards: [{ code: 'listings.total', label: '房源总数', unit: 'count', status: 'success', value: 42 }],
      trends: [
        {
          code: 'listings.created_per_day_7d',
          label: '每日新增',
          unit: 'count',
          status: 'success',
          buckets: [{ label: '2026-09-01', value: 3 }],
        },
      ],
      distributions: [],
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.asOf).toBe('2026-09-02T08:00:00.000Z')
    expect(parsed.data.cards).toHaveLength(1)
    expect(parsed.data.cards[0]).toMatchObject({ code: 'listings.total', value: 42 })
    expect(parsed.data.trends[0].buckets).toEqual([{ label: '2026-09-01', value: 3 }])
    expect(parsed.data.distributions).toEqual([])
  })

  it('非成功状态的卡照样保留，不过滤', () => {
    const parsed = parseOverviewPayload({
      ok: true,
      asOf: '2026-09-02T08:00:00.000Z',
      cards: [
        { code: 'a', label: 'A', unit: 'count', status: 'success', value: 1 },
        { code: 'b', label: 'B', unit: 'count', status: 'failed', error: 'boom' },
        { code: 'c', label: 'C', unit: 'count', status: 'no-permission' },
        { code: 'd', label: 'D', unit: 'count', status: 'not-found' },
      ],
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // 四张卡一张都不能少——这正是这层存在的理由
    expect(parsed.data.cards.map((c) => c.status)).toEqual([
      'success',
      'failed',
      'no-permission',
      'not-found',
    ])
  })

  it('ok!==true 时带出服务端错误文案', () => {
    const parsed = parseOverviewPayload({ ok: false, error: '无经营概览查看权限' })
    expect(parsed).toEqual({ ok: false, reason: '无经营概览查看权限' })
  })

  it('缺 asOf 判失败（所有卡共用同一时间锚点，缺了就无法声明数据截至时刻）', () => {
    const parsed = parseOverviewPayload({ ok: true, cards: [] })
    expect(parsed).toEqual({ ok: false, reason: '响应缺少 asOf' })
  })

  it('某一组缺失退化为空数组，而不是整页失败', () => {
    // 服务端本就允许某一组整体失败，页面该显示「这组没有数据」而不是整页报错
    const parsed = parseOverviewPayload({ ok: true, asOf: '2026-09-02T08:00:00.000Z' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.cards).toEqual([])
    expect(parsed.data.trends).toEqual([])
  })

  it('非对象响应判失败', () => {
    expect(parseOverviewPayload(null).ok).toBe(false)
    expect(parseOverviewPayload('nope').ok).toBe(false)
    expect(parseOverviewPayload([]).ok).toBe(false)
  })
})

describe('toCardView', () => {
  it('status 非法时返回 null，而不是兜底成 failed', () => {
    // 兜底成 failed 会把「后端字段改名了」伪装成「查询失败了」，
    // 契约问题被掩盖成运行时问题，排查方向直接带偏
    expect(toCardView({ code: 'x', status: 'weird' })).toBeNull()
    expect(toCardView({ code: 'x' })).toBeNull()
  })

  it('缺 code 返回 null', () => {
    expect(toCardView({ status: 'success' })).toBeNull()
    expect(toCardView({ code: '', status: 'success' })).toBeNull()
  })

  it('label 缺失退回 code，unit 非法退回 count', () => {
    const v = toCardView({ code: 'listings.total', status: 'success', unit: 'furlongs' })
    expect(v).toMatchObject({ label: 'listings.total', unit: 'count' })
  })

  it('丢弃形状不合法的桶，保留合法的', () => {
    const v = toCardView({
      code: 'x',
      status: 'success',
      buckets: [{ label: 'a', value: 1 }, { label: 'b' }, 'junk', { value: 2 }],
    })
    expect(v?.buckets).toEqual([{ label: 'a', value: 1 }])
  })

  it('value 为 0 保留为 0，不被当成缺值', () => {
    // 0 和「没有值」在看板上含义完全不同，不能都显示成 —
    const v = toCardView({ code: 'x', status: 'success', value: 0 })
    expect(v?.value).toBe(0)
  })

  it('非有限数值落成 null', () => {
    expect(toCardView({ code: 'x', status: 'success', value: Number.NaN })?.value).toBeNull()
  })
})

describe('formatMetricValue', () => {
  it('null 显示为破折号，与 0 区分开', () => {
    expect(formatMetricValue(null, 'count')).toBe('—')
    expect(formatMetricValue(0, 'count')).toBe('0')
  })

  it('按单位格式化', () => {
    expect(formatMetricValue(0.1234, 'rate')).toBe('12.3%')
    expect(formatMetricValue(12.34, 'percent')).toBe('12.3%')
    expect(formatMetricValue(1500, 'duration_ms')).toBe('1.5 秒')
    expect(formatMetricValue(90_000, 'duration_ms')).toBe('1.5 分钟')
    expect(formatMetricValue(123_456, 'currency_cny')).toContain('1,234.56')
  })
})

describe('cardStatusHint', () => {
  it('三种非成功状态给出可区分的文案', () => {
    expect(cardStatusHint(card({ status: 'success' }))).toBeNull()
    expect(cardStatusHint(card({ status: 'failed', error: 'boom' }))).toBe('查询失败：boom')
    expect(cardStatusHint(card({ status: 'failed', error: null }))).toBe('查询失败')
    expect(cardStatusHint(card({ status: 'no-permission' }))).toContain('权限')
    expect(cardStatusHint(card({ status: 'not-found' }))).toContain('未注册')
  })

  it('三种文案互不相同（否则页面上无法区分处置方式）', () => {
    const hints = (['failed', 'no-permission', 'not-found'] as const).map((status) =>
      cardStatusHint(card({ status, error: null })),
    )
    expect(new Set(hints).size).toBe(3)
  })
})

describe('maxBucketValue / formatAsOf', () => {
  it('空桶返回 0，不抛错', () => {
    expect(maxBucketValue(card({ buckets: [] }))).toBe(0)
  })

  it('取最大桶值', () => {
    expect(maxBucketValue(card({ buckets: [{ label: 'a', value: 3 }, { label: 'b', value: 7 }] }))).toBe(7)
  })

  it('不可解析的 asOf 原样返回，不假装成一个时间', () => {
    expect(formatAsOf('not-a-date')).toBe('not-a-date')
  })

  it('可解析的 asOf 转成本地文案', () => {
    expect(formatAsOf('2026-09-02T08:00:00.000Z')).not.toBe('2026-09-02T08:00:00.000Z')
  })
})
