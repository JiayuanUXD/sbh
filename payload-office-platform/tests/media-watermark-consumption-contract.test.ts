import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { pickVariantSrc } from '@/domain/public-catalog/mappers'

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8')
}

/**
 * OPT-069 的物理基础（spec §3.2）：
 *   详情画廊吃**母版** → 母版打满铺
 *   卡片吃**派生图**   → card / hero 打角标
 * 任一侧改成吃另一种文件，水印就错位——详情页会变成角标，或列表页突然满铺。
 */
describe('详情/卡片的文件消费分工', () => {
  it('DetailGallery 的主图与灯箱吃 resource.src（母版）', () => {
    const source = read('src/components/frontend/DetailGallery.tsx')
    expect(source).toContain('normalizePublicMediaUrl(item.resource?.src)')
    // 刻意不写 `expect(source).not.toContain('srcSet')`：spec §7.2 已登记一个
    // 未来改进——把缩略图条换成吃 hero 档（现在它加载全尺寸母版，4000px 原片
    // 塞进百来像素的格子）。那个改动会给缩略图**加上** srcSet 且完全合理，
    // 一刀切禁用 srcSet 会把它拦死。真正要守的是「主图/灯箱吃母版」这一条。
    expect(source).not.toContain('cardCoverProps')
  })

  it('卡片链路通过 pickVariantSrc 取派生图，默认落在 card 档', () => {
    const media = {
      src: '/api/media/file/office.jpg',
      alt: null,
      variants: [
        { src: '/api/media/file/office-320x213.webp', width: 320 },
        { src: '/api/media/file/office-768x512.webp', width: 768 },
        { src: '/api/media/file/office-1600x1067.webp', width: 1600 },
      ],
    }
    expect(pickVariantSrc(media, 768)).toBe('/api/media/file/office-768x512.webp')
    expect(pickVariantSrc(media, 320)).toBe('/api/media/file/office-320x213.webp')
  })

  it('存量图没有派生时卡片会回落母版——上线前必须先跑派生回填', () => {
    // 这条不是断言 bug，是把 spec §8.1 的上线顺序约束固化下来：
    // 母版将带满铺水印，缺派生的存量图会让列表页出现满铺卡片。
    const media = { src: '/api/media/file/legacy.jpg', alt: null, variants: undefined }
    expect(pickVariantSrc(media, 768)).toBe('/api/media/file/legacy.jpg')
  })
})
