import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')

function read(path: string): string {
  return readFileSync(resolve(miniprogramRoot, path), 'utf8')
}

describe('真实图片缺失的统一降级体验', () => {
  it('使用无虚构内容的中性建筑线稿，并为详情态提供明确说明', () => {
    const template = read('components/media-placeholder/index.wxml')
    const styles = read('components/media-placeholder/index.wxss')

    expect(template).toContain('aria-role="img"')
    expect(template).toContain('aria-label="{{label}}"')
    expect(template).toContain('media-placeholder__skyline')
    expect(template).toContain("resolvedMode !== 'compact'")
    expect(styles).toMatch(/\.media-placeholder\s*\{[\s\S]*background:\s*var\(--sbh-surface-pressed\);/)
    expect(styles).toMatch(/\.media-placeholder__tower\s*\{[\s\S]*border:\s*var\(--sbh-stroke-default\) solid currentColor;/)
    expect(`${template}\n${styles}`).not.toMatch(/emoji|🏢|🏙|🖼/i)
  })

  it('房源、楼盘、详情与个人页共享同一占位组件，不再重复品牌文字', () => {
    const targets = [
      'components/listing-card/index.wxml',
      'components/building-card/index.wxml',
      'components/detail-gallery/index.wxml',
      'pages/building-detail/index.wxml',
      'pages/profile/index.wxml',
    ]

    for (const target of targets) {
      expect(read(target), `${target} 未复用统一缺图组件`).toContain('<media-placeholder')
    }
    expect(targets.map(read).join('\n')).not.toContain('>尚办好</view>')
  })
})
