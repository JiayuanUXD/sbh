// @vitest-environment happy-dom

/**
 * 列表页两个埋点组件的行为（OPT-064）
 *
 * 这两个组件都用**变量**传事件名（`track(eventName, ...)`），
 * `analytics-event-whitelist-guard` 的静态扫描按设计扫不到它们——
 * 所以这一层必须由真实 DOM 测试补上，否则它们就是白名单守卫的盲区。
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@/lib/frontend/analytics', () => ({ track: trackSpy }))

import ListClickAnalytics from '@/components/frontend/listing/ListClickAnalytics'
import ListSearchAnalytics from '@/components/frontend/listing/ListSearchAnalytics'
import { listAnalyticsAttrs } from '@/components/frontend/listing/list-analytics'

let root: Root | null = null

beforeEach(() => {
  trackSpy.mockClear()
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function mount(node: React.ReactNode): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(node))
}

/** 按生产方（listAnalyticsAttrs）真实产出的属性建一个可点元素——不手写属性名，
 *  否则生产方改了属性名而测试没改，测试会继续绿着骗人。 */
function makeResult(attrs: Record<string, string | number>): HTMLAnchorElement {
  const a = document.createElement('a')
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, String(v))
  document.body.append(a)
  return a
}

describe('ListClickAnalytics', () => {
  it('房源结果点击上报完整属性', async () => {
    await mount(React.createElement(ListClickAnalytics))
    const el = makeResult(
      listAnalyticsAttrs({
        event: 'listing_result_click',
        city: 'shanghai',
        rank: 3,
        pageIndex: 2,
        section: 'grid',
        listingId: 42,
      }),
    )
    await act(async () => { el.click() })

    expect(trackSpy).toHaveBeenCalledWith('listing_result_click', {
      city: 'shanghai',
      listing_id: 42,
      rank: 3,
      page_index: 2,
      section: 'grid',
    })
  })

  it('楼盘结果点击上报 building_id 而不是 listing_id', async () => {
    await mount(React.createElement(ListClickAnalytics))
    const el = makeResult(
      listAnalyticsAttrs({
        event: 'building_result_click',
        city: 'beijing',
        rank: 1,
        pageIndex: 1,
        section: 'row',
        buildingId: 7,
      }),
    )
    await act(async () => { el.click() })

    expect(trackSpy).toHaveBeenCalledWith('building_result_click', {
      city: 'beijing',
      building_id: 7,
      rank: 1,
      page_index: 1,
      section: 'row',
    })
  })

  it('点击结果卡内部的子元素也能上报（靠冒泡 + closest）', async () => {
    await mount(React.createElement(ListClickAnalytics))
    const el = makeResult(
      listAnalyticsAttrs({
        event: 'listing_result_click',
        city: 'shanghai',
        rank: 1,
        pageIndex: 1,
        section: 'grid',
        listingId: 9,
      }),
    )
    const inner = document.createElement('span')
    el.append(inner)
    await act(async () => { inner.click() })
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('无关元素点击不上报', async () => {
    await mount(React.createElement(ListClickAnalytics))
    const plain = document.createElement('button')
    document.body.append(plain)
    await act(async () => { plain.click() })
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('属性残缺 / 非法时整条不报，不报脏数据', async () => {
    await mount(React.createElement(ListClickAnalytics))
    // rank 为 0（非正整数）、缺 listing_id、section 不在枚举内——各自都该被拦下
    const badCases: Array<Record<string, string>> = [
      { 'data-list-analytics-event': 'listing_result_click', 'data-analytics-city': 'shanghai', 'data-analytics-rank': '0', 'data-analytics-page-index': '1', 'data-analytics-section': 'grid', 'data-analytics-listing-id': '5' },
      { 'data-list-analytics-event': 'listing_result_click', 'data-analytics-city': 'shanghai', 'data-analytics-rank': '1', 'data-analytics-page-index': '1', 'data-analytics-section': 'grid' },
      { 'data-list-analytics-event': 'listing_result_click', 'data-analytics-city': 'shanghai', 'data-analytics-rank': '1', 'data-analytics-page-index': '1', 'data-analytics-section': 'carousel', 'data-analytics-listing-id': '5' },
      { 'data-list-analytics-event': 'not_an_event', 'data-analytics-city': 'shanghai', 'data-analytics-rank': '1', 'data-analytics-page-index': '1', 'data-analytics-section': 'grid', 'data-analytics-listing-id': '5' },
    ]
    for (const bad of badCases) {
      const el = makeResult(bad)
      await act(async () => { el.click() })
    }
    expect(trackSpy).not.toHaveBeenCalled()
  })
})

describe('ListSearchAnalytics', () => {
  const base = {
    event: 'listing_search' as const,
    city: 'shanghai',
    stateKey: 'sort=recommended',
    resultCount: 42,
    sort: 'recommended',
    filterCompleteness: 2,
    pageIndex: 1,
  }

  it('挂载即上报一次', async () => {
    await mount(React.createElement(ListSearchAnalytics, { ...base, priceUnit: 'rmb-sqm-day' }))
    expect(trackSpy).toHaveBeenCalledWith('listing_search', {
      city: 'shanghai',
      result_count: 42,
      sort: 'recommended',
      filter_completeness: 2,
      page_index: 1,
      price_unit: 'rmb-sqm-day',
    })
  })

  it('同一搜索状态重渲染不重报（后退回同一页面不该多算一次）', async () => {
    await mount(React.createElement(ListSearchAnalytics, base))
    await act(async () => root?.render(React.createElement(ListSearchAnalytics, base)))
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('换筛选条件算新事件（即使结果数等派生属性完全相同）', async () => {
    // Codex review P2 的反例：切到另一个区，结果数同样是 10、生效筛选数同样是 1、
    // 排序页码都没变。只靠派生属性拼键会把第二次搜索误判成重复而丢掉。
    await mount(React.createElement(ListSearchAnalytics, { ...base, stateKey: 'district=jingan' }))
    await act(async () =>
      root?.render(React.createElement(ListSearchAnalytics, { ...base, stateKey: 'district=xuhui' })),
    )
    expect(trackSpy).toHaveBeenCalledTimes(2)
  })

  it('翻页 / 改排序体现在 stateKey 上，同样算新事件', async () => {
    await mount(React.createElement(ListSearchAnalytics, { ...base, stateKey: 'page=1' }))
    await act(async () =>
      root?.render(React.createElement(ListSearchAnalytics, { ...base, stateKey: 'page=2', pageIndex: 2 })),
    )
    expect(trackSpy).toHaveBeenCalledTimes(2)
    expect(trackSpy.mock.calls[1][1]).toMatchObject({ page_index: 2 })
  })

  it('楼盘页不带 price_unit 键（而不是带一个空值）', async () => {
    await mount(React.createElement(ListSearchAnalytics, { ...base, event: 'building_search' }))
    expect(trackSpy).toHaveBeenCalledWith('building_search', expect.not.objectContaining({ price_unit: expect.anything() }))
  })

  it('结果为 0 也照常上报（空结果本身就是要分析的信号）', async () => {
    await mount(React.createElement(ListSearchAnalytics, { ...base, resultCount: 0 }))
    expect(trackSpy).toHaveBeenCalledWith('listing_search', expect.objectContaining({ result_count: 0 }))
  })
})
