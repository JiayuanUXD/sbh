// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlatLocationNode } from '@/domain/geography/location-tree'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

/**
 * 精选区域级联框的**搜索模式**守卫（2026-09-12 线上复现）。
 *
 * 树形面板靠 Arco 的 `disableCheckbox` 挡住前台不可见节点；但搜索面板
 * （`.arco-cascader-list-search-item`）只认 `disabled`，不可见节点的复选框照常可点，
 * 只剩 onChange 里的兜底过滤在起作用——值虽然没写进去，表单却被置脏、「保存」亮起。
 *
 * 这里真的把 Arco Cascader 渲染出来、打开下拉、输入关键词、点搜索行，
 * 断言不可见行不可勾且不触碰表单；可见行照常写入。纯函数单测覆盖不到这层集成。
 *
 * 组件静态导入（而不是每个用例 resetModules 后动态 import）：Arco Cascader 那串冷加载
 * 在 `test:changed` 与 65 个文件并行时超过 5s，会把第一个用例整个吃掉、后面的连带失败。
 * 代价是组件的模块级树缓存跨用例共享——夹具相同，无影响。
 */

const spies = vi.hoisted(() => ({
  setValue: vi.fn(),
  setModified: vi.fn(),
  dispatchFields: vi.fn(),
  state: { value: [] as unknown },
}))

vi.mock('@payloadcms/ui', () => ({
  useField: () => ({ value: spies.state.value, setValue: spies.setValue, showError: false, errorMessage: undefined }),
  useForm: () => ({ dispatchFields: spies.dispatchFields, setModified: spies.setModified }),
  useFormFields: (selector: (arg: [Record<string, { value: unknown }>]) => unknown) => selector([{}]),
  FieldLabel: ({ label }: { label?: string }) => React.createElement('label', null, label),
  FieldError: () => null,
  FieldDescription: () => null,
}))

import LocationCascadeField from '@/components/admin/LocationCascadeField'

const { setValue, setModified, dispatchFields } = spies

// 上海 → 徐汇（可见）→ 徐家汇（可见）/ 漕河泾开发区（不可见）；浦东新区（不可见）→ 陆家嘴（可见）
const nodes: FlatLocationNode[] = [
  { id: 1, name: '上海', type: 'city', immutableCode: 'SH', parentId: null, status: 'active', sortOrder: 0, frontendVisible: true },
  { id: 7, name: '徐汇', type: 'district', immutableCode: 'SH-XH', parentId: 1, status: 'active', sortOrder: 0, frontendVisible: true },
  { id: 10, name: '徐家汇', type: 'business_area', immutableCode: 'SH-XH-XJH', parentId: 7, status: 'active', sortOrder: 0, frontendVisible: true },
  { id: 802, name: '漕河泾开发区', type: 'business_area', immutableCode: 'SH-XH-CHJ', parentId: 7, status: 'active', sortOrder: 1, frontendVisible: false },
  { id: 3, name: '浦东新区', type: 'district', immutableCode: 'SH-PD', parentId: 1, status: 'active', sortOrder: 1, frontendVisible: false },
  { id: 5, name: '陆家嘴', type: 'business_area', immutableCode: 'SH-PD-LJZ', parentId: 3, status: 'active', sortOrder: 0, frontendVisible: true },
]

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  spies.state.value = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, nodes }) })),
  )
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.replaceChildren()
  setValue.mockReset()
  setModified.mockReset()
  dispatchFields.mockReset()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** 轮询等到选择器出现；并行跑时一次 flush 不一定够 */
async function waitForSelector(scope: ParentNode, selector: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const el = scope.querySelector(selector)
    if (el) return el
    await flush()
  }
  throw new Error(`等不到 ${selector}`)
}

async function renderField(props: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      React.createElement(LocationCascadeField, {
        path: 'featuredRegions',
        many: true,
        selectableTypes: ['district', 'business_area'],
        field: { label: '精选区域' },
        ...props,
      }),
    )
  })
  await waitForSelector(container, '.arco-cascader')
  return container
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openAndSearch(container: HTMLElement, keyword: string) {
  const view = container.querySelector('.arco-cascader') as HTMLElement
  await act(async () => {
    view.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
  const input = container.querySelector('.arco-cascader input') as HTMLInputElement
  expect(input).not.toBeNull()
  await act(async () => {
    setNativeValue(input, keyword)
  })
  await waitForSelector(document, '.arco-cascader-list-search-item')
  return [...document.querySelectorAll('.arco-cascader-list-search-item')] as HTMLElement[]
}

const rowByText = (rows: HTMLElement[], text: string) => {
  const row = rows.find((r) => r.textContent?.includes(text))
  if (!row) throw new Error(`没有找到搜索行：${text}；现有：${rows.map((r) => r.textContent).join(' | ')}`)
  return row
}

const clickRow = async (row: HTMLElement) => {
  // 点在文字上：与运营真实点击落点一致，也是最容易穿透到 li 的位置
  const target = (row.querySelector('.arco-checkbox-text') ?? row) as HTMLElement
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('LocationCascadeField 搜索模式（frontendVisibleOnly）', () => {
  it('祖先命中带出的不可见节点：复选框禁用、标注可见、点击不写值也不置脏', async () => {
    const c = await renderField({ frontendVisibleOnly: true })
    const rows = await openAndSearch(c, '徐汇')
    const hidden = rowByText(rows, '漕河泾开发区')
    expect(hidden.textContent).toContain('（前台不可见）')
    const checkbox = hidden.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.disabled).toBe(true)
    expect(hidden.querySelector('[aria-disabled="true"]')).not.toBeNull()

    await clickRow(hidden)
    expect(setValue).not.toHaveBeenCalled()
    expect(setModified).not.toHaveBeenCalled()
  })

  it('穿透到 li 的点击（行内空白 / 键盘 Enter 同路径）进了 onChange 也不写值、不置脏', async () => {
    const c = await renderField({ frontendVisibleOnly: true })
    const rows = await openAndSearch(c, '徐汇')
    const hidden = rowByText(rows, '漕河泾开发区')
    // 直接点 li：绕过自渲染内容上的 stopPropagation，走 Arco handleSearchOptionClick → onChange
    await act(async () => {
      hidden.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(setValue).not.toHaveBeenCalled()
    expect(setModified).not.toHaveBeenCalled()
    // 同一条路径上可见节点是通的：证明上面的「没调用」不是事件没送到
    const visible = rowByText(rows, '徐家汇')
    await act(async () => {
      visible.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(setValue).toHaveBeenLastCalledWith([10])
  })

  it('不可见行政区自身不可勾，但它底下可见的商圈在搜索结果里照常可勾', async () => {
    const c = await renderField({ frontendVisibleOnly: true })
    const rows = await openAndSearch(c, '上海')
    const pudong = rowByText(rows, '浦东新区')
    expect((pudong.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
    const lujiazui = rowByText(rows, '陆家嘴')
    expect((lujiazui.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)

    await clickRow(lujiazui)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenLastCalledWith([5])
  })

  it('可见节点照常可勾并写入 id', async () => {
    const c = await renderField({ frontendVisibleOnly: true })
    const rows = await openAndSearch(c, '徐汇')
    const visible = rowByText(rows, '徐家汇')
    expect((visible.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)

    await clickRow(visible)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenLastCalledWith([10])
  })

  it('对照：不开 frontendVisibleOnly 时（楼盘归属等场景）不可见节点在搜索里照常可选', async () => {
    const c = await renderField({})
    const rows = await openAndSearch(c, '徐汇')
    const row = rowByText(rows, '漕河泾开发区')
    expect(row.textContent).not.toContain('（前台不可见）')
    expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)

    await clickRow(row)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenLastCalledWith([802])
  })
})
