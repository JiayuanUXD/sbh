import Link from 'next/link'
import React from 'react'
import { Media } from '@/components/frontend/ui/Media'
import type { DistrictCardViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页「热门商圈」bento（方案 1：大卡 2fr×480 + 2×232 + 2×280）。
 *
 * 降级规则（cards 按 recommendedOrder 已排好，这里只取前 5）：
 *   - 5 张：完整 bento（大卡 + 竖排 2 小卡 + 底行 2 宽卡）；
 *   - 3~4 张：只渲染第一行（大卡 + 竖排 2 小卡），多出的第 4 张不展示——
 *     宁可少一张也不凑单卡宽底行；
 *   - 1~2 张：降级为等分一行（高 280，复用 .hm-bento__wide）；
 *   - 0 张：整段不渲染。
 */
function BentoCard({ card, prefix, sizeClass }: Readonly<{
  card: DistrictCardViewModel
  prefix: string
  sizeClass: string
}>) {
  return (
    <Link
      href={`${prefix}/listings?district=${encodeURIComponent(card.slug)}`}
      prefetch={false}
      className={`hm-bento-card ${sizeClass}`}
      data-event-name="home_district_click"
    >
      {card.coverImage ? (
        // bento 三档坑位宽度差得远（大卡约占容器 2/3，小卡/宽卡各约 1/3），
        // 用最大的那档报 sizes：报小了浏览器会选到糊图，报大了只是多下一档。
        <Media media={card.coverImage} ratio="auto" sizes="(max-width: 767px) 100vw, 800px" />
      ) : null}
      <span className="sf-scrim" aria-hidden="true" />
      <span className="hm-bento-card__label">
        <span className="hm-bento-card__name">{card.name}</span>
        {card.buildings.length > 0
          ? <span className="hm-bento-card__buildings">{card.buildings.join(' · ')}</span>
          : null}
      </span>
    </Link>
  )
}

export default function HomeDistrictBento({ cards, totalAreas, citySlug }: Readonly<{
  cards: readonly DistrictCardViewModel[]
  totalAreas: number
  citySlug?: string
}>) {
  if (cards.length === 0) return null
  const prefix = citySlug ? `/${citySlug}` : ''

  let body: React.ReactNode
  if (cards.length >= 5) {
    const [main, sideA, sideB, wideA, wideB] = cards
    body = (
      <>
        <div className="hm-bento__row">
          <BentoCard card={main} prefix={prefix} sizeClass="hm-bento__main" />
          <div className="hm-bento__side">
            <BentoCard card={sideA} prefix={prefix} sizeClass="hm-bento__small" />
            <BentoCard card={sideB} prefix={prefix} sizeClass="hm-bento__small" />
          </div>
        </div>
        <div className="hm-bento__row">
          <BentoCard card={wideA} prefix={prefix} sizeClass="hm-bento__wide" />
          <BentoCard card={wideB} prefix={prefix} sizeClass="hm-bento__wide" />
        </div>
      </>
    )
  } else if (cards.length >= 3) {
    const [main, sideA, sideB] = cards
    body = (
      <div className="hm-bento__row">
        <BentoCard card={main} prefix={prefix} sizeClass="hm-bento__main" />
        <div className="hm-bento__side">
          <BentoCard card={sideA} prefix={prefix} sizeClass="hm-bento__small" />
          <BentoCard card={sideB} prefix={prefix} sizeClass="hm-bento__small" />
        </div>
      </div>
    )
  } else {
    body = (
      <div className="hm-bento__row">
        {cards.map((card) => (
          <BentoCard key={card.slug} card={card} prefix={prefix} sizeClass="hm-bento__wide" />
        ))}
      </div>
    )
  }

  return (
    <section className="hm-section" aria-labelledby="hm-districts-title">
      <div className="hm-container">
        <div className="hm-section-head">
          <h2 className="hm-h2" id="hm-districts-title">热门商圈</h2>
          <Link href={`${prefix}/listings`} prefetch={false} className="hm-section-link" data-event-name="home_district_view_all">
            全部 <span className="sf-num">{totalAreas.toLocaleString('en-US')}</span> 个商圈
          </Link>
        </div>
        <div className="hm-bento">{body}</div>
      </div>
    </section>
  )
}
