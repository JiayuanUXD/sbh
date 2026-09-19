import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FilterFormC, { countActivePicks, type FilterRow } from '@/components/frontend/listing/FilterFormC'

/** OPT-103：底栏不再报「N 套符合条件」，没有已选条件时整个底栏不渲染。 */

const ROWS: readonly FilterRow[] = [
  { key: 'district', label: '位置', options: [{ value: 'jingan', label: '静安', count: 3 }] },
]

function render(rows: readonly FilterRow[], extraPicks: readonly { key: string; label: string; href: string }[] = []) {
  return renderToStaticMarkup(createElement(FilterFormC, {
    rows,
    basePath: '/shanghai/listings',
    currentParams: new URLSearchParams(rows[0]?.activeValue ? `district=${rows[0].activeValue}` : ''),
    clearAllHref: '/shanghai/listings',
    extraPicks,
  }))
}

describe('FilterFormC 底栏', () => {
  it('没有已选条件：不渲染底栏、不出现「符合条件」', () => {
    const html = render(ROWS)
    expect(html).not.toContain('ls-filterc__footer')
    expect(html).not.toContain('符合条件')
  })

  it('有已选条件：只渲染 chip 与清除全部，仍然没有计数与分隔线', () => {
    const html = render([{ ...ROWS[0], activeValue: 'jingan' }])
    expect(html).toContain('ls-filterc__footer')
    expect(html).toContain('位置：静安')
    expect(html).toContain('清除全部')
    expect(html).not.toContain('符合条件')
    expect(html).not.toContain('ls-filterc__divider')
  })

  it('只有补充 chip（生效但无行可显示的条件）也算有条件', () => {
    const html = render(ROWS, [{ key: 'q', label: '关键词：整层', href: '/shanghai/listings' }])
    expect(html).toContain('关键词：整层')
    expect(html).toContain('清除全部')
  })

  it('countActivePicks 按可见行 + extraPicks 计数（开关型行已移除；T17 起补充 chip 计入）', () => {
    expect(countActivePicks([{ ...ROWS[0], activeValue: 'jingan' }])).toBe(1)
    expect(countActivePicks(ROWS)).toBe(0)
    expect(countActivePicks(ROWS, [{ key: 'q', label: '关键词：整层', href: '/x' }])).toBe(1)
    expect(countActivePicks([{ ...ROWS[0], activeValue: 'jingan' }], [{ key: 'q', label: '关键词：整层', href: '/x' }])).toBe(2)
  })
})
