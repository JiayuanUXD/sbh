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

  // --- OPT-059：srcset 与焦点 ---------------------------------------------

  const SIZED = {
    src: '/media/original.jpg',
    alt: '静安中心',
    variants: [
      { src: '/media/320.webp', width: 320 },
      { src: '/media/768.webp', width: 768 },
    ],
  }

  it('有派生尺寸时渲染 srcSet 与 sizes', () => {
    const html = renderToStaticMarkup(
      createElement(Media, { media: SIZED, sizes: '(max-width: 767px) 100vw, 320px' }),
    )
    expect(html).toContain('/media/320.webp 320w')
    expect(html).toContain('/media/768.webp 768w')
    expect(html).toContain('sizes="(max-width: 767px) 100vw, 320px"')
  })

  it('无派生尺寸时不渲染 srcSet（存量图回落原图）', () => {
    const html = renderToStaticMarkup(
      createElement(Media, { media: { src: '/media/original.jpg', alt: 'x' } }),
    )
    expect(html).not.toContain('srcSet')
    expect(html).not.toContain('srcset')
    expect(html).toContain('src="/media/original.jpg"')
  })

  it('有焦点时写入 CSS 自定义属性', () => {
    const html = renderToStaticMarkup(
      createElement(Media, { media: { ...SIZED, focal: { x: 30, y: 70 } } }),
    )
    expect(html).toContain('--focal-x:30%')
    expect(html).toContain('--focal-y:70%')
  })

  it('无焦点时不写变量，交给 CSS 的 50% 回退值（等于改动前的居中裁切）', () => {
    const html = renderToStaticMarkup(createElement(Media, { media: SIZED }))
    expect(html).not.toContain('--focal-x')
  })

  it('cover 语义的共享规则带焦点回退值，缺省行为与改动前一致', () => {
    const surface = readFileSync('src/app/(frontend)/styles/surface.css', 'utf8')
    const home = readFileSync('src/app/(frontend)/styles/home.css', 'utf8')
    expect(surface).toMatch(/\.sf-media img\s*\{[^}]*object-position:\s*var\(--focal-x,\s*50%\)\s*var\(--focal-y,\s*50%\)/s)
    expect(home).toMatch(/\.hm-bento-card img\s*\{[^}]*object-position:\s*var\(--focal-x,\s*50%\)\s*var\(--focal-y,\s*50%\)/s)
  })
})
