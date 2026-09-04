import { describe, expect, it } from 'vitest'

import {
  buildBadgeOverlay,
  buildTiledOverlay,
  computeWatermarkVersion,
  DEFAULT_WATERMARK_CONFIG,
  estimateTextWidth,
} from '@/domain/media/watermark'

const TILED = { text: '商办荟 SHANGBANHUI', density: 3, opacity: 0.38, angle: -30 }
const BADGE = { text: '商办荟 SHANGBANHUI', position: 'bottom-right' as const, opacity: 0.95 }

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('estimateTextWidth', () => {
  it('CJK 按 1em、拉丁按 0.62em、空格按 0.3em 估算', () => {
    expect(estimateTextWidth('商办荟', 100)).toBeCloseTo(300, 5)
    expect(estimateTextWidth('AB', 100)).toBeCloseTo(124, 5)
    expect(estimateTextWidth('商 A', 100)).toBeCloseTo(192, 5)
  })
})

describe('buildTiledOverlay', () => {
  it('字号随图宽等比缩放——任何母版尺寸下版式一致', () => {
    const big = buildTiledOverlay({ width: 2400, height: 1600, config: TILED }).toString()
    const small = buildTiledOverlay({ width: 1200, height: 800, config: TILED }).toString()
    const fontSizeOf = (svg: string) => Number(/font-size="([\d.]+)"/.exec(svg)![1])
    expect(fontSizeOf(big) / fontSizeOf(small)).toBeCloseTo(2, 1)
  })

  it('必须带描边——纯白半透明字在落地窗那类高亮区会完全消失', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: TILED }).toString()
    expect(svg).toContain('paint-order="stroke"')
    expect(svg).toContain('stroke="#000"')
  })

  it('整幅统一旋转，而不是逐字旋转', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: TILED }).toString()
    expect(svg).toContain('rotate(-30 400 300)')
    expect(countOccurrences(svg, '<g transform="rotate')).toBe(1)
  })

  it('density 越大，铺的文字越多', () => {
    const sparse = buildTiledOverlay({ width: 2400, height: 1600, config: { ...TILED, density: 2 } }).toString()
    const dense = buildTiledOverlay({ width: 2400, height: 1600, config: { ...TILED, density: 5 } }).toString()
    expect(countOccurrences(dense, '<text')).toBeGreaterThan(countOccurrences(sparse, '<text'))
  })

  it('网格范围超出画布，保证旋转后四角也被盖到', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: TILED }).toString()
    const xs = [...svg.matchAll(/<text x="(-?[\d.]+)"/g)].map((m) => Number(m[1]))
    expect(Math.min(...xs)).toBeLessThan(0)
    expect(Math.max(...xs)).toBeGreaterThan(800)
  })

  it('opacity 同时作用于填充与描边', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, opacity: 0.4 } }).toString()
    expect(svg).toContain('fill-opacity="0.4"')
    expect(svg).toContain('stroke-opacity="0.2"')
  })

  it('SVG 宽高等于传入的画布尺寸', () => {
    const svg = buildTiledOverlay({ width: 1234, height: 567, config: TILED }).toString()
    expect(svg).toContain('width="1234"')
    expect(svg).toContain('height="567"')
  })

  it('文案里的 XML 特殊字符被转义', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, text: 'A&B<C>' } }).toString()
    expect(svg).toContain('A&amp;B&lt;C&gt;')
  })
})

describe('buildBadgeOverlay', () => {
  it('bottom-right 时角标贴右下', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 800, config: BADGE }).toString()
    const rectX = Number(/<rect x="([\d.]+)"/.exec(svg)![1])
    const rectY = Number(/<rect x="[\d.]+" y="([\d.]+)"/.exec(svg)![1])
    expect(rectX).toBeGreaterThan(500)
    expect(rectY).toBeGreaterThan(400)
  })

  it('top-left 时角标贴左上', () => {
    const svg = buildBadgeOverlay({
      width: 1000,
      height: 800,
      config: { ...BADGE, position: 'top-left' },
    }).toString()
    const rectX = Number(/<rect x="([\d.]+)"/.exec(svg)![1])
    const rectY = Number(/<rect x="[\d.]+" y="([\d.]+)"/.exec(svg)![1])
    expect(rectX).toBeLessThan(100)
    expect(rectY).toBeLessThan(100)
  })

  it('底板宽度随文案长度增长', () => {
    const short = buildBadgeOverlay({ width: 1000, height: 800, config: { ...BADGE, text: 'AB' } }).toString()
    const long = buildBadgeOverlay({ width: 1000, height: 800, config: { ...BADGE, text: 'ABCDEFGHIJ' } }).toString()
    const widthOf = (svg: string) => Number(/<rect [^>]*width="([\d.]+)"/.exec(svg)![1])
    expect(widthOf(long)).toBeGreaterThan(widthOf(short))
  })
})

describe('computeWatermarkVersion', () => {
  it('配置相同则版本相同', () => {
    expect(computeWatermarkVersion(DEFAULT_WATERMARK_CONFIG)).toBe(
      computeWatermarkVersion({ ...DEFAULT_WATERMARK_CONFIG }),
    )
  })

  it('任一参数变化都会改变版本——否则重刷任务会静默跳过该跑的图', () => {
    const base = computeWatermarkVersion(DEFAULT_WATERMARK_CONFIG)
    const changed = computeWatermarkVersion({
      ...DEFAULT_WATERMARK_CONFIG,
      tiled: { ...DEFAULT_WATERMARK_CONFIG.tiled, opacity: 0.99 },
    })
    expect(changed).not.toBe(base)
  })
})
