// @vitest-environment happy-dom

/**
 * OPT-062 终审 A：封面区块的渲染层守卫。
 *
 * `geography-drawer-cover.test.ts` 全部是源码字符串断言（`SRC.toContain('supportsCover')`
 * 之类）。审查者做了变异测试：把 `GeographyListViewClient.tsx` 里整块
 * `{module.supportsCover ? <Form.Item label="封面图">…</Form.Item> : null}` 删掉，
 * `pnpm test` 288 files / 3934 passed，与基线一字不差——字符串断言被 `ClientModule`
 * 的类型声明和弹层挂载条件双重满足，删渲染块它照样绿。这正是 OPT-060 终审抓到的同型缺陷。
 *
 * 本文件因此真正挂载组件、模拟点击「编辑」打开抽屉，断言渲染出的 DOM 文本，
 * 而不是断言源码字符串——这样删掉渲染块会让抽屉里真的少了这块内容，测试才会变红。
 * 顺带补上规格 §9「封面字段只在 business_area / district 出现」的渲染层守卫
 * （此前该守卫只存在于 geography-modules.ts 配置层，见 geography-drawer-cover.test.ts）。
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/geography/business-areas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

import GeographyListViewClient, {
  type GeographyRow,
} from '@/components/admin/geography/GeographyListViewClient'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

function buildRow(overrides: Partial<GeographyRow> = {}): GeographyRow {
  return {
    id: 1,
    name: '陆家嘴',
    immutableCode: 'sh-ljz',
    status: 'active',
    frontendVisible: true,
    sortOrder: 1,
    centerLatitude: null,
    centerLongitude: null,
    version: 1,
    parentName: null,
    cityName: null,
    hasBoundary: true,
    hasCover: false,
    coverImage: null,
    counts: {},
    ...overrides,
  }
}

type TestModule = Parameters<typeof GeographyListViewClient>[0]['module']

const BASE_MODULE: TestModule = {
  type: 'business_area',
  route: '/geography/business-areas',
  title: '商圈管理',
  columns: [],
  filters: [],
  chips: [],
  emptyHint: '暂无数据',
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  if (container) container.remove()
  container = null
})

/** 挂载组件、点击唯一一行的「编辑」按钮打开抽屉，返回抽屉此刻的整页文本。 */
async function openDrawerAndGetText(module: TestModule): Promise<string> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(
      React.createElement(GeographyListViewClient, {
        module,
        rows: [buildRow()],
        total: 1,
        page: 1,
        totalPages: 1,
        cityOptions: [],
        districtOptions: [],
      }),
    )
  })

  const editButton = Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent === '编辑',
  )
  expect(editButton, '未找到「编辑」按钮，测试前提不成立').toBeDefined()

  await act(async () => {
    editButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  return document.body.textContent ?? ''
}

describe('抽屉封面区块渲染守卫（OPT-062 终审 A）', () => {
  it('supportsCover=true 时，抽屉里真的渲染出封面图区块', async () => {
    const text = await openDrawerAndGetText({ ...BASE_MODULE, supportsCover: true })
    expect(text).toContain('封面图')
    expect(text).toContain('从素材库选择')
  })

  it('supportsCover=false 时，抽屉里不出现封面图区块（负对照）', async () => {
    const text = await openDrawerAndGetText({ ...BASE_MODULE, supportsCover: false })
    expect(text).not.toContain('封面图')
    expect(text).not.toContain('从素材库选择')
  })

  it('supportsCover 未设置（city / metro_line 等模块）时，抽屉里同样不出现封面图区块', async () => {
    const text = await openDrawerAndGetText({ ...BASE_MODULE })
    expect(text).not.toContain('封面图')
    expect(text).not.toContain('从素材库选择')
  })
})
