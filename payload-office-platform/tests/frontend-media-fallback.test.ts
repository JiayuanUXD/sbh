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
  // 2026-09-04 起缺省态文案由「暂无图片」改为「图片拍摄中」（产品要求）——
  // 两套文案必须不同这条不变，变的只是缺省态那一串。
  it('renders a "no image" placeholder when media is absent', () => {
    const html = renderToStaticMarkup(
      createElement(Media, {
        media: null,
        fallbackAlt: '外滩源 · 共享办公',
      }),
    )

    expect(html).toContain('图片拍摄中')
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

    expect(emptyHtml).toContain('图片拍摄中')
    expect(emptyHtml).toContain('media-placeholder')
    expect(emptyHtml).toContain('aria-label="外滩源 · 共享办公 图片拍摄中"')
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

  // --- OPT-059 复核：decorative（装饰图对辅助技术完全静默）--------------------
  //
  // 首页「按类型浏览」「热门商圈」两处卡片，图片旁边就是可见的类型名/商圈名，
  // 图片本身不承载额外信息。改动前两处都是 alt=""；换成 Media 后如果不传
  // decorative，alt 会取到 media.alt（真实数据里是某条具体房源的标题），读屏
  // 用户会听到一段和卡片主体无关的公告——这是决不能带来的前台回归。

  it('decorative 正常渲染时 alt 恒为空，忽略 media.alt / fallbackAlt', () => {
    const html = renderToStaticMarkup(
      createElement(Media, {
        media: { ...SIZED, alt: '静安中心 · 联合办公详情页标题' },
        fallbackAlt: '这个也不该出现',
        decorative: true,
      }),
    )
    expect(html).toContain('alt=""')
    expect(html).not.toContain('静安中心 · 联合办公详情页标题')
    expect(html).not.toContain('这个也不该出现')
  })

  it('decorative 占位分支（缺失或加载失败）整体对辅助技术隐藏，不发 role="img"', () => {
    const html = renderToStaticMarkup(
      createElement(Media, {
        media: null,
        fallbackAlt: '这个也不该被读出来',
        decorative: true,
      }),
    )
    expect(html).toContain('media-placeholder')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
    expect(html).not.toContain('aria-label')
    expect(html).not.toContain('这个也不该被读出来')
  })

  it('非 decorative 时占位分支保持原有 role="img" + aria-label 行为不变', () => {
    const html = renderToStaticMarkup(
      createElement(Media, { media: null, fallbackAlt: '外滩源 · 共享办公' }),
    )
    // 装饰图标 svg 本身一直带 aria-hidden="true"（不受 decorative 影响），所以
    // 这里只断言外层 .media-placeholder 容器没有被打上 aria-hidden，不能整段
    // 字符串比对。
    const containerTag = html.match(/^<div class="media-placeholder"[^>]*>/)?.[0] ?? ''
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="外滩源 · 共享办公"')
    expect(containerTag).not.toContain('aria-hidden')
  })
})
