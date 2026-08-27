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

  // OPT-059 复核：两处图旁边都已有可见的类型名/商圈名文字，图片不承载额外
  // 信息，必须用 decorative 让 Media 对辅助技术完全静默——否则 alt 会取到
  // 真实数据里某条具体房源的标题，读屏用户会听到一段无关公告。锁住这两个
  // 调用处确实传了 decorative，防止以后有人在重构时顺手删掉。
  it('两处调用都显式声明 decorative（图片旁已有可见文字，不能读出无关 alt）', () => {
    expect(TYPE_CARDS).toMatch(/<Media\b[^>]*\bdecorative\b[^>]*\/>/)
    expect(BENTO).toMatch(/<Media\b[^>]*\bdecorative\b[^>]*\/>/)
  })
})
