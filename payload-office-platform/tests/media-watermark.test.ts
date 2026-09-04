import { describe, expect, it } from 'vitest'

import {
  buildBadgeOverlay,
  buildTiledOverlay,
  computeWatermarkVersion,
  DEFAULT_WATERMARK_CONFIG,
  estimateTextWidth,
  mergeWatermarkConfig,
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

describe('buildTiledOverlay 退化输入守卫', () => {
  it('空文案返回空 overlay 而不是 NaN SVG', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, text: '' } }).toString()
    expect(svg).toContain('width="800"')
    expect(svg).toContain('height="600"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  it('仅空白文案返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, text: '   ' } }).toString()
    expect(svg).not.toContain('<text')
  })

  it('density 为 0 返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, density: 0 } }).toString()
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('Infinity')
  })

  it('density 为负数返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, density: -1 } }).toString()
    expect(svg).not.toContain('<text')
  })

  it('宽度为 0 返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 0, height: 600, config: TILED }).toString()
    expect(svg).not.toContain('<text')
  })

  it('高度为 0 返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 800, height: 0, config: TILED }).toString()
    expect(svg).not.toContain('<text')
  })

  it('负数尺寸返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: -100, height: -100, config: TILED }).toString()
    expect(svg).not.toContain('<text')
  })

  it('非有限 density 返回空 overlay', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: { ...TILED, density: Infinity } }).toString()
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('Infinity')
  })
})

describe('buildBadgeOverlay 退化输入守卫', () => {
  it('空文案返回空 overlay', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 800, config: { ...BADGE, text: '' } }).toString()
    expect(svg).toContain('width="1000"')
    expect(svg).toContain('height="800"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<rect')
  })

  it('仅空白文案返回空 overlay', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 800, config: { ...BADGE, text: '  ' } }).toString()
    expect(svg).not.toContain('<rect')
  })

  it('零宽度返回空 overlay', () => {
    const svg = buildBadgeOverlay({ width: 0, height: 800, config: BADGE }).toString()
    expect(svg).not.toContain('<rect')
  })

  it('零高度返回空 overlay', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 0, config: BADGE }).toString()
    expect(svg).not.toContain('<rect')
  })

  it('负数尺寸返回空 overlay', () => {
    const svg = buildBadgeOverlay({ width: -100, height: -100, config: BADGE }).toString()
    expect(svg).not.toContain('<rect')
  })
})

describe('mergeWatermarkConfig', () => {
  it('null 配置回落到默认值', () => {
    const merged = mergeWatermarkConfig(null)
    expect(merged).toEqual(DEFAULT_WATERMARK_CONFIG)
  })

  it('undefined 配置回落到默认值', () => {
    const merged = mergeWatermarkConfig(undefined)
    expect(merged).toEqual(DEFAULT_WATERMARK_CONFIG)
  })

  it('非对象配置回落到默认值', () => {
    const merged = mergeWatermarkConfig('not an object')
    expect(merged).toEqual(DEFAULT_WATERMARK_CONFIG)
  })

  it('全 null group 不能用 spread 覆盖默认值', () => {
    const stored = { tiled: { density: null, text: null, opacity: null, angle: null }, badge: { text: null, opacity: null, position: null } }
    const merged = mergeWatermarkConfig(stored)
    // density null 应该回落到默认 3，不能用 null 覆盖默认值
    expect(merged.tiled.density).toBe(DEFAULT_WATERMARK_CONFIG.tiled.density)
  })

  it('文案空白时回落到 fallbackText', () => {
    const stored = { tiled: { density: 3, text: '  ', opacity: 0.5, angle: -30 }, badge: { text: '', opacity: 0.5, position: 'bottom-right' as const } }
    const merged = mergeWatermarkConfig(stored, '万千楼盘')
    expect(merged.tiled.text).toBe('万千楼盘')
    expect(merged.badge.text).toBe('万千楼盘')
  })

  it('fallbackText 也为空时回落到默认文案', () => {
    const stored = { tiled: { density: 3, text: '', opacity: 0.5, angle: -30 }, badge: { text: '  ', opacity: 0.5, position: 'bottom-right' as const } }
    const merged = mergeWatermarkConfig(stored, '')
    expect(merged.tiled.text).toBe(DEFAULT_WATERMARK_CONFIG.tiled.text)
    expect(merged.badge.text).toBe(DEFAULT_WATERMARK_CONFIG.badge.text)
  })

  it('fallbackText 为 null 时回落到默认文案', () => {
    const stored = { tiled: { density: 3, text: '', opacity: 0.5, angle: -30 }, badge: { text: '', opacity: 0.5, position: 'bottom-right' as const } }
    const merged = mergeWatermarkConfig(stored, null)
    expect(merged.tiled.text).toBe(DEFAULT_WATERMARK_CONFIG.tiled.text)
  })

  it('density 夹到 [2, 6]', () => {
    expect(mergeWatermarkConfig({ tiled: { density: 0 } }).tiled.density).toBe(2)
    expect(mergeWatermarkConfig({ tiled: { density: 1 } }).tiled.density).toBe(2)
    expect(mergeWatermarkConfig({ tiled: { density: 2 } }).tiled.density).toBe(2)
    expect(mergeWatermarkConfig({ tiled: { density: 6 } }).tiled.density).toBe(6)
    expect(mergeWatermarkConfig({ tiled: { density: 10 } }).tiled.density).toBe(6)
  })

  it('opacity 夹到 (0, 1]', () => {
    expect(mergeWatermarkConfig({ tiled: { opacity: 0 } }).tiled.opacity).toBe(0.01)
    expect(mergeWatermarkConfig({ tiled: { opacity: 0.5 } }).tiled.opacity).toBe(0.5)
    expect(mergeWatermarkConfig({ tiled: { opacity: 1 } }).tiled.opacity).toBe(1)
    expect(mergeWatermarkConfig({ tiled: { opacity: 2 } }).tiled.opacity).toBe(1)
  })

  it('angle 夹到 [-90, 90]', () => {
    expect(mergeWatermarkConfig({ tiled: { angle: -180 } }).tiled.angle).toBe(-90)
    expect(mergeWatermarkConfig({ tiled: { angle: -30 } }).tiled.angle).toBe(-30)
    expect(mergeWatermarkConfig({ tiled: { angle: 90 } }).tiled.angle).toBe(90)
    expect(mergeWatermarkConfig({ tiled: { angle: 180 } }).tiled.angle).toBe(90)
  })

  it('非有限值回落到默认值', () => {
    expect(mergeWatermarkConfig({ tiled: { density: Infinity } }).tiled.density).toBe(DEFAULT_WATERMARK_CONFIG.tiled.density)
    expect(mergeWatermarkConfig({ tiled: { opacity: NaN } }).tiled.opacity).toBe(DEFAULT_WATERMARK_CONFIG.tiled.opacity)
    expect(mergeWatermarkConfig({ tiled: { angle: Infinity } }).tiled.angle).toBe(DEFAULT_WATERMARK_CONFIG.tiled.angle)
  })

  it('储存配置的有效值完全回落', () => {
    const stored = {
      tiled: { density: 4, text: '我的项目', opacity: 0.5, angle: -45 },
      badge: { text: '我的项目', opacity: 0.8, position: 'top-right' as const },
    }
    const merged = mergeWatermarkConfig(stored)
    expect(merged.tiled.density).toBe(4)
    expect(merged.tiled.text).toBe('我的项目')
    expect(merged.tiled.opacity).toBe(0.5)
    expect(merged.tiled.angle).toBe(-45)
    expect(merged.badge.text).toBe('我的项目')
    expect(merged.badge.opacity).toBe(0.8)
    expect(merged.badge.position).toBe('top-right')
  })

  it('stored 为 null 时仍应用 fallbackText 到文案', () => {
    const merged = mergeWatermarkConfig(null, '万千楼盘')
    expect(merged.tiled.text).toBe('万千楼盘')
    expect(merged.badge.text).toBe('万千楼盘')
  })

  it('stored 为 undefined 时仍应用 fallbackText 到文案', () => {
    const merged = mergeWatermarkConfig(undefined, '万千楼盘')
    expect(merged.tiled.text).toBe('万千楼盘')
    expect(merged.badge.text).toBe('万千楼盘')
  })

  it('stored 为非对象时仍应用 fallbackText 到文案', () => {
    const merged = mergeWatermarkConfig('not an object', '万千楼盘')
    expect(merged.tiled.text).toBe('万千楼盘')
    expect(merged.badge.text).toBe('万千楼盘')
  })

  it('badge 文案应回落到各自的默认值而非 tiled 的', () => {
    const stored = { tiled: { text: '' }, badge: { text: '' } }
    // 这个测试确保即使两个默认值目前相同，逻辑也是隔离的
    const merged = mergeWatermarkConfig(stored)
    expect(merged.badge.text).toBe(DEFAULT_WATERMARK_CONFIG.badge.text)
  })
})

describe('emptyOverlay 守卫 - NaN/Infinity 必须不出现在 SVG 属性里', () => {
  it('width 为 NaN 时不产生 NaN 属性值', () => {
    const svg = buildTiledOverlay({ width: NaN, height: 600, config: TILED }).toString()
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('width=')
  })

  it('height 为 Infinity 时不产生 Infinity 属性值', () => {
    const svg = buildTiledOverlay({ width: 800, height: Infinity, config: TILED }).toString()
    expect(svg).not.toContain('Infinity')
    expect(svg).toContain('height=')
  })

  it('width 为 -Infinity 时不产生 Infinity 属性值', () => {
    const svg = buildTiledOverlay({ width: -Infinity, height: 600, config: TILED }).toString()
    expect(svg).not.toContain('Infinity')
    expect(svg).not.toContain('NaN')
  })

  it('badge 的 NaN width 也不产生 NaN 属性值', () => {
    const svg = buildBadgeOverlay({ width: NaN, height: 600, config: BADGE }).toString()
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('width=')
  })

  it('badge 的 Infinity height 也不产生 Infinity 属性值', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: Infinity, config: BADGE }).toString()
    expect(svg).not.toContain('Infinity')
    expect(svg).toContain('height=')
  })
})
