import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * OPT-059：两个首页图卡区块必须走共享原语，不能再各写各的 <img>。
 *
 * 用源码断言而非渲染断言，是因为这里要守的是**结构性约束**（"不许再写裸 img"），
 * 渲染快照挡不住有人新加一个裸 <img>。同仓库 listings-query-prefetch-performance
 * 用的是同一种手法。
 */
const TYPE_CARDS = readFileSync('src/components/frontend/home/HomeTypeCards.tsx', 'utf8')
const BENTO = readFileSync('src/components/frontend/home/HomeDistrictBento.tsx', 'utf8')

describe('首页图卡走共享图片原语', () => {
  it('HomeTypeCards 不再直接写 <img', () => {
    expect(TYPE_CARDS).not.toContain('<img')
    expect(TYPE_CARDS).toContain("from '@/components/frontend/ui/Media'")
  })

  it('HomeDistrictBento 不再直接写 <img', () => {
    expect(BENTO).not.toContain('<img')
    expect(BENTO).toContain("from '@/components/frontend/ui/Media'")
  })

  it('两处都传了 sizes——没有它浏览器会按视口宽度猜，在小卡上必然选过大的档', () => {
    expect(TYPE_CARDS).toContain('sizes=')
    expect(BENTO).toContain('sizes=')
  })

  it('压暗层与埋点未被改动带走', () => {
    expect(TYPE_CARDS).toContain('sf-scrim')
    expect(TYPE_CARDS).toContain('data-event-name')
    expect(BENTO).toContain('sf-scrim')
    expect(BENTO).toContain('data-event-name="home_district_click"')
  })
})
