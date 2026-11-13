import { describe, expect, it } from 'vitest'
import { serializeLexicalToHtml } from '../src/domain/mini-program/lexical-to-html'

describe('Lexical AST 到标准 HTML 转换引擎', () => {
  it('空或无效 AST 返回空字符串', () => {
    expect(serializeLexicalToHtml(null)).toBe('')
    expect(serializeLexicalToHtml(undefined)).toBe('')
    expect(serializeLexicalToHtml({})).toBe('')
    expect(serializeLexicalToHtml({ root: null })).toBe('')
  })

  it('段落与普通文本转换', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '北外滩地处虹口区南部。' },
            ],
          },
        ],
      },
    }
    expect(serializeLexicalToHtml(ast)).toBe('<p class="mini-rich-p">北外滩地处虹口区南部。</p>')
  })

  it('标题节点（h1, h2, h3）转换', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '一级标题' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '二级标题' }],
          },
          {
            type: 'heading',
            tag: 'h3',
            children: [{ type: 'text', text: '三级标题' }],
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).toContain('<h2 class="mini-rich-h2">一级标题</h2>')
    expect(html).toContain('<h2 class="mini-rich-h2">二级标题</h2>')
    expect(html).toContain('<h3 class="mini-rich-h3">三级标题</h3>')
  })

  it('有序与无序列表转换', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'list',
            listType: 'bullet',
            children: [
              {
                type: 'listitem',
                children: [{ type: 'text', text: '项目优势 1' }],
              },
              {
                type: 'listitem',
                children: [{ type: 'text', text: '项目优势 2' }],
              },
            ],
          },
          {
            type: 'list',
            listType: 'number',
            children: [
              {
                type: 'listitem',
                children: [{ type: 'text', text: '步骤 1' }],
              },
            ],
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).toContain('<ul class="mini-rich-ul"><li>项目优势 1</li><li>项目优势 2</li></ul>')
    expect(html).toContain('<ol class="mini-rich-ol"><li>步骤 1</li></ol>')
  })

  it('引用块与分割线转换', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'quote',
            children: [{ type: 'text', text: '重点提示' }],
          },
          {
            type: 'horizontalrule',
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).toContain('<blockquote class="mini-rich-quote">重点提示</blockquote>')
    expect(html).toContain('<hr class="mini-rich-hr" />')
  })

  it('行内样式（粗体、斜体、下划线、删除线）渲染', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '普通' },
              { type: 'text', text: '粗体', format: 1 }, // bold
              { type: 'text', text: '斜体', format: 2 }, // italic
              { type: 'text', text: '下划线', format: 8 }, // underline
              { type: 'text', text: '删除线', format: 4 }, // strikethrough
            ],
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<u>下划线</u>')
    expect(html).toContain('<s>删除线</s>')
  })

  it('upload 图片节点转换带有安全的移动端样式', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'upload',
            value: {
              url: 'https://example.com/photo.jpg',
              alt: '大厦实景',
            },
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).toContain('<img class="mini-rich-img" src="https://example.com/photo.jpg" alt="大厦实景"')
    expect(html).toContain('style="max-width:100%;height:auto;border-radius:12rpx;display:block;margin:24rpx 0;"')
  })

  it('严格防御 XSS 注入与过滤未知危险标签', () => {
    const ast = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '<script>alert("xss")</script>&<foo>' },
            ],
          },
          {
            type: 'unknown_dangerous_tag',
            raw: '<iframe src="evil.com"></iframe>',
          },
        ],
      },
    }
    const html = serializeLexicalToHtml(ast)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<iframe>')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&lt;foo&gt;')
  })
})
