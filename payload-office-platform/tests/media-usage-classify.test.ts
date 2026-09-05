import { describe, expect, it } from 'vitest'

import { classifyMediaUsage, extractMediaIds } from '@/domain/media/usage-classify'

const NONE = { listingPhoto: 0, article: 0, brand: 0, report: 0 }

describe('classifyMediaUsage', () => {
  it('被房源/楼盘引用 → listing-photo', () => {
    expect(classifyMediaUsage({ ...NONE, listingPhoto: 1 })).toBe('listing-photo')
  })

  it('被文章引用 → article', () => {
    expect(classifyMediaUsage({ ...NONE, article: 1 })).toBe('article')
  })

  it('被站点设置/页面/商圈/城市站引用 → brand', () => {
    expect(classifyMediaUsage({ ...NONE, brand: 1 })).toBe('brand')
  })

  it('举报截图 → other', () => {
    expect(classifyMediaUsage({ ...NONE, report: 1 })).toBe('other')
  })

  it('无人引用 → other', () => {
    expect(classifyMediaUsage(NONE)).toBe('other')
  })

  it('多处引用时按 listing-photo > article > brand > other 定优先级', () => {
    expect(classifyMediaUsage({ listingPhoto: 1, article: 1, brand: 1, report: 1 })).toBe('listing-photo')
    expect(classifyMediaUsage({ listingPhoto: 0, article: 1, brand: 1, report: 1 })).toBe('article')
    expect(classifyMediaUsage({ listingPhoto: 0, article: 0, brand: 1, report: 1 })).toBe('brand')
  })
})

describe('extractMediaIds', () => {
  it('命名 group 嵌套：直接拼出 group.field 路径', () => {
    expect(extractMediaIds({ hero: { image: 42 } }, 'hero.image')).toEqual([42])
  })

  it('数组嵌套（数组元素是对象）：展开每一行取子字段', () => {
    expect(
      extractMediaIds({ gallery: [{ image: 1 }, { image: 2 }] }, 'gallery.image'),
    ).toEqual([1, 2])
  })

  it('裸关系字段：顶层字段不经任何容器', () => {
    expect(extractMediaIds({ coverImage: 7 }, 'coverImage')).toEqual([7])
  })

  it('字段为 null：不当成命中', () => {
    expect(extractMediaIds({ coverImage: null }, 'coverImage')).toEqual([])
  })

  it('字段整个缺失（文档里没有这个 key）：不当成命中', () => {
    expect(extractMediaIds({}, 'coverImage')).toEqual([])
  })

  it('空数组：没有行可展开，返回空', () => {
    expect(extractMediaIds({ gallery: [] }, 'gallery.image')).toEqual([])
  })

  it('populated {id} 对象与裸数字 id 两种形态都要认得出', () => {
    expect(
      extractMediaIds(
        { gallery: [{ image: 3 }, { image: { id: 4, url: '/x.jpg' } }] },
        'gallery.image',
      ),
    ).toEqual([3, 4])
  })
})
