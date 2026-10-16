import { describe, expect, it } from 'vitest'

import { lexicalPlainTextLength, markdownToLexical, parseInline } from '../scripts/lib/markdown-to-lexical'

describe('markdownToLexical', () => {
  it('把标题 / 段落 / 列表 / 引用 / 分隔线转成前台白名单节点', () => {
    const doc = markdownToLexical(
      ['## 小节', '', '第一行', '第二行', '', '- 甲', '- 乙', '', '1. 一', '2. 二', '', '> 提示', '', '---'].join('\n'),
    )
    const types = doc.root.children.map((n) => n.type)
    expect(types).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'horizontalrule'])
    const [heading, paragraph, bullets, ordered] = doc.root.children
    expect(heading).toMatchObject({ tag: 'h2' })
    // 软换行合并成一段，不留 \n
    expect(paragraph).toMatchObject({ children: [{ text: '第一行 第二行' }] })
    expect(bullets).toMatchObject({ listType: 'bullet', tag: 'ul' })
    expect(ordered).toMatchObject({ listType: 'number', tag: 'ol' })
    expect((ordered as { children: unknown[] }).children).toHaveLength(2)
  })

  it('行内粗体与链接：链接同时带顶层 url（前台渲染器）与 fields（后台编辑器）', () => {
    const nodes = parseInline('看**重点**，详见[在租房源](/shanghai/listings)。')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'text', 'text', 'link', 'text'])
    expect(nodes[1]).toMatchObject({ text: '重点', format: 1 })
    expect(nodes[3]).toMatchObject({
      url: '/shanghai/listings',
      fields: { linkType: 'custom', url: '/shanghai/listings' },
    })
  })

  it.each([
    ['# 一级标题', '一级标题'],
    ['| a | b |', '表格'],
    ['```\ncode\n```', '代码块'],
    ['![图](x.png)', '行内图片'],
    ['<div>x</div>', 'HTML'],
    ['- 甲\n  - 嵌套', '嵌套列表'],
    ['[点](javascript:alert(1))', '链接地址'],
    ['[点](//evil.example)', '链接地址'],
    ['有**未闭合粗体', '粗体'],
  ])('拒绝不支持的写法：%s', (source, reason) => {
    expect(() => markdownToLexical(source)).toThrow(reason)
  })

  it('统计纯文本字数时忽略空白与标记', () => {
    const doc = markdownToLexical('## 标题\n\n正文 **加粗** 结尾')
    expect(lexicalPlainTextLength(doc)).toBe('标题正文加粗结尾'.length)
  })
})
