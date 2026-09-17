import { describe, expect, it } from 'vitest'

import { Buildings } from '@/collections/Buildings'

/**
 * 楼盘编辑表单的布局不变量（OPT-102，口径同 tests/listing-form-layout.test.ts）。
 *
 * 每一条都对应一个**会静默失效**的坑：
 *
 *   1. row 内字段不给 admin.width，mergeFieldStyles 下发的是 flex: 1 1 auto（grow=1），
 *      该字段会拉伸填满整行，把固定列轴撑歪。少给一个就毁一行。
 *   2. 「展示内容」必须独立成 tab：Payload 客户端只渲染激活 tab，它装着楼盘媒体资源
 *      （maxRows 40，mount 即发 /api/media）和 Lexical 富文本。谁把它并进「基础信息」，
 *      每次打开楼盘都要多付这笔首屏开销。
 *   3. 分节用 ui 字段而不是 collapsible：折叠态持久化到用户 preferences，收起后字段
 *      找得到却不可见（理由见 ListingFormSectionHeading 文件头）。
 */

type AnyField = Record<string, any>

const fields = Buildings.fields as AnyField[]
const tabsField = fields.find((f) => f.type === 'tabs') as AnyField
const tabs = tabsField.tabs as AnyField[]

/** 深度遍历一棵字段树（含 row / group / collapsible / tabs / array）。 */
function walk(nodes: AnyField[], visit: (node: AnyField, parents: AnyField[]) => void, parents: AnyField[] = []) {
  for (const node of nodes) {
    visit(node, parents)
    if (Array.isArray(node.fields)) walk(node.fields, visit, [...parents, node])
    if (Array.isArray(node.tabs)) walk(node.tabs, visit, [...parents, node])
  }
}

const sectionTitles = (tab: AnyField): string[] =>
  (tab.fields as AnyField[])
    .filter(
      (f) =>
        f.type === 'ui' &&
        String(f.admin?.components?.Field?.path ?? '').includes('ListingFormSectionHeading'),
    )
    .map((h) => h.admin.components.Field.clientProps.title)

describe('building-form-layout/tab 结构', () => {
  it('只有两个 tab：基础信息 + 展示内容', () => {
    expect(tabs.map((t) => t.label)).toEqual(['基础信息', '展示内容'])
  })

  it('重组件都在「展示内容」里，不会被带进首屏', () => {
    const display = tabs.find((t) => t.label === '展示内容') as AnyField
    const names = new Set<string>()
    walk(display.fields, (n) => {
      if (n.name) names.add(n.name)
    })
    expect(names).toContain('mediaItems')
    expect(names).toContain('description')
    expect(names).toContain('amenities')

    const info = tabs.find((t) => t.label === '基础信息') as AnyField
    const infoNames = new Set<string>()
    walk(info.fields, (n) => {
      if (n.name) infoNames.add(n.name)
    })
    expect(infoNames).not.toContain('mediaItems')
    expect(infoNames).not.toContain('description')
    expect(infoNames).not.toContain('amenities')
  })

  it('原来的三个 tab 降级为 ui 分节标题，且不带 name（不进数据路径）', () => {
    const info = tabs.find((t) => t.label === '基础信息') as AnyField
    expect(sectionTitles(info)).toEqual(['基本信息', '位置交通', '楼宇属性', '核验与版本', '数据来源'])
    const display = tabs.find((t) => t.label === '展示内容') as AnyField
    expect(sectionTitles(display)).toEqual(['媒体与配套', '介绍与 SEO'])
    walk(fields, (n) => {
      if (n.type === 'ui') expect(n.name, 'ui 分节不得带 name').toBeUndefined()
    })
  })

  it('分节不用 collapsible —— 折叠态会让字段找得到却不可见', () => {
    const collapsibles: string[] = []
    walk(fields, (n) => {
      if (n.type === 'collapsible') collapsibles.push(String(n.label ?? '(无标题)'))
    })
    expect(collapsibles).toEqual([])
  })

  it('版本号用只读展示态组件，不是禁用输入框', () => {
    let version: AnyField | undefined
    walk(fields, (n) => {
      if (n.name === 'version') version = n
    })
    expect(version?.admin?.readOnly).toBe(true)
    expect(String(version?.admin?.components?.Field ?? '')).toContain('ListingReadonlyValue')
  })

  it('级联控制器接管的两个隐藏字段不包在 row 里', () => {
    // 不渲染的字段没有列宽可言，留在 row 里只会给「row 内字段必须给 width」的守卫添豁免。
    walk(fields, (n, parents) => {
      if (n.name === 'district' || n.name === 'businessDistrict') {
        expect(n.admin?.hidden, `${n.name} 应为 hidden`).toBe(true)
        expect(parents.at(-1)?.type, `${n.name} 不应在 row 里`).not.toBe('row')
      }
    })
  })
})

describe('building-form-layout/固定列轴', () => {
  it('每个 row 里的字段都显式给了 admin.width', () => {
    const missing: string[] = []
    walk(fields, (node) => {
      if (node.type !== 'row' || !Array.isArray(node.fields)) return
      for (const child of node.fields as AnyField[]) {
        if (child.admin?.disabled || child.admin?.hidden) continue // 不渲染的字段无所谓宽度
        if (!child.admin?.width) missing.push(child.name ?? `(${child.type})`)
      }
    })
    expect(missing).toEqual([])
  })

  it('列宽取值收敛在三个常量上，避免出现 40%/60% 这类对不齐的宽度', () => {
    const widths = new Set<string>()
    walk(fields, (node) => {
      if (node.admin?.width) widths.add(node.admin.width)
    })
    expect([...widths].sort()).toEqual(['100%', '25%', '33.333%'])
  })

  it('基本信息节 3 列，其余节 4 列（与房源 OPT-032 §3.3-A3 同口径）', () => {
    const info = tabs.find((t) => t.label === '基础信息') as AnyField
    let section = ''
    const bad: string[] = []
    for (const f of info.fields as AnyField[]) {
      if (f.type === 'ui') {
        section = f.admin?.components?.Field?.clientProps?.title ?? section
        continue
      }
      walk([f], (node) => {
        if (node.type !== 'row') return
        for (const child of node.fields as AnyField[]) {
          const width = child.admin?.width
          if (!width || child.admin?.hidden) continue
          const expected = section === '基本信息' ? '33.333%' : '25%'
          if (width !== expected && width !== '100%') bad.push(`${section}/${child.name}: ${width}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
