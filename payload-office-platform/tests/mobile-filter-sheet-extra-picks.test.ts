// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

import MobileFilterSheet from '@/components/frontend/listing/MobileFilterSheet'
import { countActivePicks, type FilterRow } from '@/components/frontend/listing/FilterFormC'

/**
 * TODOS T17：抽屉里显示「没有任何一行能显示」的生效条件（extraPicks）。
 *
 * OPT-103 去掉楼盘页「仅看有在租」开关后，`?onlyWithStock=1` 老链接在桌面由底栏
 * 补充 chip 显示并可清除，但 `.ls-filterc` 在 ≤767px 整块隐藏——移动端出现
 * 「页头说筛选出 5 个、抽屉说已选 0 项」的自相矛盾。这里锁三件事：
 *   1. 抽屉顶部有一组「其他条件」，每个 extraPick 是一个选中态 pill，href 即清除地址；
 *   2. 「已选 N 项」把 extraPicks 计进去，且与悬浮 pill 徽标共用 `countActivePicks`；
 *   3. 没有 extraPicks 时这一组整个不渲染（老页面结构零变化）。
 */

const ROWS: readonly FilterRow[] = [
  { key: 'district', label: '位置', options: [{ value: 'jingan', label: '静安', count: 3 }] },
]

const EXTRA = [
  { key: 'onlyWithStock', label: '在租状态：仅看有在租', href: '/shanghai/buildings?district=jingan' },
  { key: 'q', label: '关键词：整层', href: '/shanghai/listings' },
] as const

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

async function renderSheet(props: { rows?: readonly FilterRow[]; extraPicks?: readonly { key: string; label: string; href: string }[] }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const triggerRef = { current: document.createElement('button') }
  await act(async () => {
    root?.render(
      React.createElement(MobileFilterSheet, {
        rows: props.rows ?? ROWS,
        open: true,
        onClose: () => {},
        basePath: '/shanghai/buildings',
        currentParams: new URLSearchParams('district=jingan'),
        totalDocs: 5,
        countNoun: '个楼盘',
        triggerRef,
        resetHref: '/shanghai/buildings',
        ...(props.extraPicks ? { extraPicks: props.extraPicks } : {}),
      }),
    )
  })
  return document.querySelector('.ls-msheet') as HTMLElement
}

describe('MobileFilterSheet 的 extraPicks', () => {
  it('渲染成「其他条件」一组选中态 pill，href 是清除地址，且排在各行之前', async () => {
    const sheet = await renderSheet({ rows: [{ ...ROWS[0], activeValue: 'jingan' }], extraPicks: EXTRA })
    const groups = [...sheet.querySelectorAll('.ls-msheet__group')]
    expect(groups[0]?.querySelector('.ls-msheet__group-label')?.textContent).toBe('其他条件')
    const pills = [...groups[0]!.querySelectorAll('a.ls-pill')]
    expect(pills.map((a) => a.textContent)).toEqual(['在租状态：仅看有在租', '关键词：整层'])
    expect(pills.map((a) => a.getAttribute('href'))).toEqual([EXTRA[0].href, EXTRA[1].href])
    expect(pills.every((a) => a.classList.contains('ls-pill--active'))).toBe(true)
    expect(pills.every((a) => a.getAttribute('aria-current') === 'true')).toBe(true)
    // 位置行仍在其后
    expect(groups[1]?.querySelector('.ls-msheet__group-label')?.textContent).toBe('位置')
  })

  it('「已选 N 项」计入 extraPicks，口径与 countActivePicks 一致', async () => {
    const rows = [{ ...ROWS[0], activeValue: 'jingan' }]
    const sheet = await renderSheet({ rows, extraPicks: EXTRA })
    expect(sheet.querySelector('.ls-msheet__picked')?.textContent).toBe('已选 3 项')
    expect(countActivePicks(rows, EXTRA)).toBe(3)
    expect(countActivePicks(rows)).toBe(1)
    expect(countActivePicks(ROWS, EXTRA)).toBe(2)
  })

  it('没有 extraPicks 时不渲染这一组，头部计数照旧', async () => {
    const sheet = await renderSheet({ rows: ROWS })
    expect([...sheet.querySelectorAll('.ls-msheet__group-label')].map((e) => e.textContent)).toEqual(['位置'])
    expect(sheet.querySelector('.ls-msheet__picked')?.textContent).toBe('')
    const empty = await renderSheet({ rows: ROWS, extraPicks: [] })
    expect([...empty.querySelectorAll('.ls-msheet__group-label')].map((e) => e.textContent)).toEqual(['位置'])
  })
})
