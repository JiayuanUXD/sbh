import { describe, expect, it } from 'vitest'

import { resolveTypeCardCovers } from '@/lib/frontend/type-card-covers'

const IMG_A = { src: '/media/a.jpg', alt: 'A' } as const
const IMG_B = { src: '/media/b.jpg', alt: 'B' } as const

const CARDS = [
  { slot: 'traditional-office', label: '传统办公', sublabel: '独立空间', coverImage: null },
  { slot: 'coworking', label: '联合办公', sublabel: '工位起', coverImage: IMG_A },
] as const

describe('resolveTypeCardCovers', () => {
  it('没有覆盖 → 原样返回全局默认', () => {
    const out = resolveTypeCardCovers(CARDS, [])
    expect(out.map((c) => c.coverImage)).toEqual([null, IMG_A])
  })

  it('城市覆盖盖过全局默认', () => {
    const out = resolveTypeCardCovers(CARDS, [{ slot: 'coworking', coverImage: IMG_B }])
    expect(out.find((c) => c.slot === 'coworking')?.coverImage).toEqual(IMG_B)
  })

  it('全局为空时，城市覆盖也能补上（不是只在有默认时才生效）', () => {
    const out = resolveTypeCardCovers(CARDS, [{ slot: 'traditional-office', coverImage: IMG_B }])
    expect(out.find((c) => c.slot === 'traditional-office')?.coverImage).toEqual(IMG_B)
  })

  it('覆盖里出现卡片列表没有的槽位 → 忽略，不凭空造出一张卡', () => {
    const out = resolveTypeCardCovers(CARDS, [{ slot: 'full-floor', coverImage: IMG_B }])
    expect(out).toHaveLength(2)
    expect(out.map((c) => c.slot)).toEqual(['traditional-office', 'coworking'])
  })

  it('不碰文案、不改顺序', () => {
    const out = resolveTypeCardCovers(CARDS, [{ slot: 'coworking', coverImage: IMG_B }])
    expect(out.map((c) => c.slot)).toEqual(['traditional-office', 'coworking'])
    expect(out.map((c) => c.label)).toEqual(['传统办公', '联合办公'])
    expect(out.map((c) => c.sublabel)).toEqual(['独立空间', '工位起'])
  })

  it('同槽位重复覆盖取首次出现（与 orderByFeaturedRegions 口径一致）', () => {
    const out = resolveTypeCardCovers(CARDS, [
      { slot: 'coworking', coverImage: IMG_B },
      { slot: 'coworking', coverImage: IMG_A },
    ])
    expect(out.find((c) => c.slot === 'coworking')?.coverImage).toEqual(IMG_B)
  })
})
