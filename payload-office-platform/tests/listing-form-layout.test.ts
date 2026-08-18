import { describe, expect, it } from 'vitest'

import { Listings } from '@/collections/Listings'
import { deriveListingSelfVisibility } from '@/domain/review/listing-self-visibility'

/**
 * 房源编辑表单的布局不变量（OPT-032 §3.3-A）。
 *
 * 这些不是「好看」的断言，每一条都对应一个**会静默失效**的坑：
 *
 *   1. locateTab 与 tab label 是按文字匹配的。对不上时 ListingVisibilityCardClient
 *      的点击定位什么都不做——不报错、不跳转，运营只会觉得「这卡片点了没反应」。
 *   2. row 内字段不给 admin.width，mergeFieldStyles 下发的是 flex: 1 1 auto（grow=1），
 *      该字段会拉伸填满整行，把固定列轴撑歪。少给一个就毁一行。
 *   3. 「展示内容」必须独立成 tab：Payload 客户端只渲染激活 tab，它装着媒体工作台
 *      （maxRows 40）和 Lexical 富文本，占全表单绝大部分首屏渲染量。谁把它并进
 *      「房源信息」，每次打开房源都要多付这笔账。
 */

type AnyField = Record<string, any>

const fields = Listings.fields as AnyField[]
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

describe('listing-form-layout/tab 结构', () => {
  it('只有两个 tab：房源信息 + 展示内容', () => {
    expect(tabs.map((t) => t.label)).toEqual(['房源信息', '展示内容'])
  })

  it('重组件都在「展示内容」里，不会被带进首屏', () => {
    const display = tabs.find((t) => t.label === '展示内容') as AnyField
    const names = new Set<string>()
    walk(display.fields, (n) => {
      if (n.name) names.add(n.name)
    })
    // 媒体工作台 mount 即发 /api/media 并渲染最多 40 张缩略图；richText 要实例化 Lexical
    expect(names).toContain('mediaItems')
    expect(names).toContain('description')

    const info = tabs.find((t) => t.label === '房源信息') as AnyField
    const infoNames = new Set<string>()
    walk(info.fields, (n) => {
      if (n.name) infoNames.add(n.name)
    })
    expect(infoNames).not.toContain('mediaItems')
    expect(infoNames).not.toContain('description')
  })

  it('原来的四个 tab 降级为 ui 分节标题，且不带 name（不进数据路径）', () => {
    const info = tabs.find((t) => t.label === '房源信息') as AnyField
    const headings = (info.fields as AnyField[]).filter(
      (f) =>
        f.type === 'ui' &&
        String(f.admin?.components?.Field?.path ?? '').includes('ListingFormSectionHeading'),
    )
    const titles = headings.map((h) => h.admin.components.Field.clientProps.title)
    expect(titles).toEqual([
      '基本信息',
      // 价格分节的标题随 saleChannelEnabled 开关变（价格与交易参数 / 租赁参数）
      titles[1],
      '审核与发布',
      '状态（只读）',
      '数据来源',
    ])
    for (const h of headings) expect(h.name).toBeUndefined()
  })

  it('分节不用 collapsible —— 折叠态会让点击定位滚不到目标字段', () => {
    // Collapsible 折叠时仍渲染 children（只是套 height: 0），label 找得到却不可见；
    // 且折叠态持久化到用户 preferences，靠 initCollapsed 默认展开挡不住。
    const collapsibles: string[] = []
    walk(fields, (n) => {
      if (n.type === 'collapsible') collapsibles.push(String(n.label ?? '(无标题)'))
    })
    expect(collapsibles).toEqual([])
  })

  it('只读状态四项用展示态组件，不是禁用输入框', () => {
    for (const name of ['reviewStatus', 'publicationStatus', 'supplyVisibilityHold', 'version']) {
      let found: AnyField | undefined
      walk(fields, (n) => {
        if (n.name === name) found = n
      })
      expect(found?.admin?.readOnly, `${name} 应为只读`).toBe(true)
      expect(String(found?.admin?.components?.Field ?? '')).toContain('ListingReadonlyValue')
    }
  })

  it('URL 标识从表单撤下，但保留在 API 与库里', () => {
    let slug: AnyField | undefined
    walk(fields, (n) => {
      if (n.name === 'slug') slug = n
    })
    // admin.disabled：不渲染、不进表单状态、不校验，但不影响 API 输出与生成类型。
    // 不能用 admin.hidden（仍参与校验 → 看不见的必填错误）、
    // 不能用顶层 hidden（afterRead 会从响应里删掉 slug，前台详情页崩）、
    // 不能用 admin.condition（configToJSONSchema 会把类型弱化成 slug?: string | null）。
    expect(slug?.admin?.disabled).toBe(true)
    expect(slug?.hidden).toBeUndefined()
    expect(slug?.admin?.condition).toBeUndefined()
    expect(slug?.required).toBe(true)

    // 值改由标题框右侧的图标展示
    let title: AnyField | undefined
    walk(fields, (n) => {
      if (n.name === 'title') title = n
    })
    expect(String(title?.admin?.components?.afterInput ?? '')).toContain('ListingSlugBadge')
  })
})

describe('listing-form-layout/固定列轴', () => {
  it('每个 row 里的字段都显式给了 admin.width', () => {
    const missing: string[] = []
    walk(fields, (node) => {
      if (node.type !== 'row' || !Array.isArray(node.fields)) return
      for (const child of node.fields as AnyField[]) {
        if (child.admin?.disabled) continue // 不渲染的字段无所谓宽度
        if (!child.admin?.width) missing.push(child.name ?? `(${child.type})`)
      }
    })
    // 少一个就会拉伸填满整行，把那一行的列轴撑歪
    expect(missing).toEqual([])
  })

  it('列宽取值收敛在三个常量上，避免出现 40%/60% 这类对不齐的宽度', () => {
    const widths = new Set<string>()
    walk(fields, (node) => {
      if (node.admin?.width) widths.add(node.admin.width)
    })
    expect([...widths].sort()).toEqual(['100%', '25%', '33.333%'])
  })
})

describe('listing-form-layout/点击定位不会静默失效', () => {
  it('每个 locateTab 都能对应到一个真实的 tab label', () => {
    const tabLabels = new Set(tabs.map((t) => t.label))
    const result = deriveListingSelfVisibility({
      publicationStatus: 'draft',
      reviewStatus: 'not_submitted',
      supplyVisibilityHold: 'pending_recheck',
      reportPaused: true,
      galleryCount: 0,
    })
    const targets = result.checks.flatMap((c) => (c.locateTab === null ? [] : [c.locateTab]))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) expect(tabLabels).toContain(target)
  })

  it('每个 locateFieldLabel 都能对应到一个真实的字段 label', () => {
    const fieldLabels = new Set<string>()
    walk(fields, (node) => {
      if (typeof node.label === 'string') fieldLabels.add(node.label)
    })
    const result = deriveListingSelfVisibility({
      publicationStatus: 'draft',
      reviewStatus: 'not_submitted',
      supplyVisibilityHold: 'pending_recheck',
      reportPaused: true,
      galleryCount: 0,
    })
    // locateCheck 用 startsWith 匹配 label 文本，字段改名而这里没跟上就滚不到目标
    for (const check of result.checks) {
      if (check.locateFieldLabel === undefined) continue
      expect(fieldLabels).toContain(check.locateFieldLabel)
    }
  })
})
