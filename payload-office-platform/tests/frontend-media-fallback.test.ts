import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import DetailGallery from '@/components/frontend/DetailGallery'
import { Media } from '@/components/frontend/ui/Media'

const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')

describe('frontend media fallback', () => {
  // 无图房源自 2026-08-19 起是常态（前台可见性不再要求图片），所以「本就没图」
  // 与「图没加载出来」必须是两套文案：前者说「暂未加载」会让人一直等。
  it('renders a "no image" placeholder when media is absent', () => {
    const html = renderToStaticMarkup(
      createElement(Media, {
        media: null,
        fallbackAlt: '外滩源 · 共享办公',
      }),
    )

    expect(html).toContain('暂无图片')
    expect(html).toContain('data-media-state="missing"')
    expect(html).not.toContain('图片暂未加载')
    expect(html).toContain('aria-label="外滩源 · 共享办公"')
  })

  it('keeps the "failed to load" copy for media that exists but errors', () => {
    const source = readFileSync('src/components/frontend/ui/Media.tsx', 'utf8')
    expect(source).toContain('图片暂未加载')
    expect(source).toContain('可先查看房源信息')
    expect(readFileSync('src/components/frontend/DetailGallery.tsx', 'utf8')).toContain(
      '图片暂未加载',
    )
  })

  it('detail page renders the shared placeholder surface with zero media', () => {
    const emptyHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: [], title: '外滩源 · 共享办公' }),
    )

    expect(emptyHtml).toContain('暂无图片')
    expect(emptyHtml).toContain('media-placeholder')
    expect(emptyHtml).toContain('aria-label="外滩源 · 共享办公 暂无图片"')
  })

  it('styles media placeholders as a designed surface instead of a broken-image gap', () => {
    expect(css).toMatch(/\.media-placeholder__text\s*\{[^}]*font-size:\s*var\(--fs-14\)/s)
    expect(css).toMatch(/\.detail-gallery__fallback\s*\{[^}]*linear-gradient/s)
  })
})
