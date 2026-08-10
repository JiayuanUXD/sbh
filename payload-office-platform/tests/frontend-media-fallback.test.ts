import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import DetailGallery from '@/components/frontend/DetailGallery'
import { Media } from '@/components/frontend/ui/Media'

const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')

describe('frontend media fallback', () => {
  it('renders a user-friendly card placeholder when media is missing', () => {
    const html = renderToStaticMarkup(
      createElement(Media, {
        media: null,
        fallbackAlt: '外滩源 · 共享办公',
      }),
    )

    expect(html).toContain('图片暂未加载')
    expect(html).toContain('可先查看房源信息')
    expect(html).toContain('aria-label="外滩源 · 共享办公"')
  })

  it('uses the same user-friendly placeholder copy for failed listing detail media', () => {
    const source = readFileSync('src/components/frontend/DetailGallery.tsx', 'utf8')
    const emptyHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: [], title: '外滩源 · 共享办公' }),
    )

    expect(source).toContain('图片暂未加载')
    expect(source).toContain('可先查看房源信息')
    expect(emptyHtml).toContain('暂无可展示媒体')
  })

  it('styles media placeholders as a designed surface instead of a broken-image gap', () => {
    expect(css).toMatch(/\.media-placeholder__text\s*\{[^}]*font-size:\s*var\(--fs-14\)/s)
    expect(css).toMatch(/\.detail-gallery__fallback\s*\{[^}]*linear-gradient/s)
  })
})
