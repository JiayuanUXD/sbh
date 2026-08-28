import { describe, expect, it } from 'vitest'

import { mapTypeCardOverrides } from '@/lib/frontend/type-card-covers'

const GOOD_MEDIA = {
  id: 9,
  alt: '陆家嘴联合办公',
  url: '/api/media/file/cover.jpg',
  width: 1280,
  height: 960,
  sizes: {
    thumb: { url: '/api/media/file/cover-320.webp', width: 320 },
    card: { url: '/api/media/file/cover-768.webp', width: 768 },
  },
  focalX: 30,
  focalY: 70,
}

describe('mapTypeCardOverrides', () => {
  it('配了覆盖 → 出现在结果里，封面带 variants 与 focal（OPT-059 的派生尺寸不能丢）', () => {
    const out = mapTypeCardOverrides([{ slot: 'coworking', coverImage: GOOD_MEDIA }])
    expect(out).toHaveLength(1)
    expect(out[0]?.slot).toBe('coworking')
    expect(out[0]?.coverImage.src).toBe('/api/media/file/cover.jpg')
    expect(out[0]?.coverImage.variants).toEqual([
      { src: '/api/media/file/cover-320.webp', width: 320 },
      { src: '/api/media/file/cover-768.webp', width: 768 },
    ])
    expect(out[0]?.coverImage.focal).toEqual({ x: 30, y: 70 })
  })

  it('没配 → 空数组，不是 undefined（消费方只需判一种空）', () => {
    expect(mapTypeCardOverrides(undefined)).toEqual([])
    expect(mapTypeCardOverrides(null)).toEqual([])
    expect(mapTypeCardOverrides([])).toEqual([])
  })

  it.each([
    ['slot 缺失', { coverImage: GOOD_MEDIA }],
    ['slot 不是字符串', { slot: 7, coverImage: GOOD_MEDIA }],
    ['slot 是空串', { slot: '', coverImage: GOOD_MEDIA }],
    ['封面缺失', { slot: 'coworking' }],
    ['封面 url 不安全', { slot: 'coworking', coverImage: { ...GOOD_MEDIA, url: 'javascript:alert(1)' } }],
    ['封面是协议相对 URL', { slot: 'coworking', coverImage: { ...GOOD_MEDIA, url: '//cdn.example.com/x.jpg' } }],
  ])('单行损坏（%s）→ 只丢那一行，其余行仍在', (_label, broken) => {
    const out = mapTypeCardOverrides([broken, { slot: 'full-floor', coverImage: GOOD_MEDIA }])
    expect(out.map((r) => r.slot)).toEqual(['full-floor'])
  })

  it('同槽位重复配置取首次出现（与 orderByFeaturedRegions 口径一致）', () => {
    const other = { ...GOOD_MEDIA, url: '/api/media/file/other.jpg' }
    const out = mapTypeCardOverrides([
      { slot: 'coworking', coverImage: GOOD_MEDIA },
      { slot: 'coworking', coverImage: other },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.coverImage.src).toBe('/api/media/file/cover.jpg')
  })
})
