import { describe, expect, it } from 'vitest'

import { Media } from '@/collections/Media'

/**
 * OPT-059：派生尺寸是渲染管线的地基，被 mapMedia 与 ui/Media 依赖。
 * 这里锁住档位名与宽度——改名会让 mapMedia 静默取不到派生图（回落原图、
 * 不报错、只是变慢变糊），是那种「测试不红但功能失效」的改动。
 */
describe('Media 集合的派生尺寸配置', () => {
  const upload = Media.upload as Exclude<typeof Media.upload, boolean | undefined>

  it('焦点选择开启（前台 object-position 依赖 focalX/focalY）', () => {
    expect(upload.focalPoint).toBe(true)
  })

  it('三档宽度型派生，档位名与宽度锁定', () => {
    const sizes = upload.imageSizes ?? []
    expect(sizes.map((s) => s.name)).toEqual(['thumb', 'card', 'hero'])
    expect(sizes.map((s) => s.width)).toEqual([320, 768, 1600])
  })

  it('派生图不裁剪：只给 width、不给 height（比例交给 CSS object-fit）', () => {
    for (const size of upload.imageSizes ?? []) {
      expect(size.height).toBeUndefined()
    }
  })

  it('小图不放大：withoutEnlargement 全开', () => {
    for (const size of upload.imageSizes ?? []) {
      expect(size.withoutEnlargement).toBe(true)
    }
  })

  it('统一输出 webp', () => {
    for (const size of upload.imageSizes ?? []) {
      expect(size.formatOptions?.format).toBe('webp')
    }
  })

  it('prefix 字段仍在且带 defaultValue（本地/CI 无 COS 时不 500 的前提）', () => {
    const prefix = Media.fields.find((f) => 'name' in f && f.name === 'prefix')
    expect(prefix).toBeDefined()
    expect((prefix as { defaultValue?: unknown }).defaultValue).toBe('media')
  })
})
