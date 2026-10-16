import Link from 'next/link'
import React from 'react'
import { Media } from '@/components/frontend/ui/Media'
import type { DistrictCardViewModel } from '@/domain/public-catalog/contracts'
import { areaLandingPath } from '@/domain/public-catalog/area-landing'
/**
 * OPT-035 首页「热门商圈」bento（方案 1：大卡 2fr×480 + 2×232 + 2×280）。
 *
 * 调用方（`CityHomeView.tsx`）已按城市配置把 cards 截到对应张数（3 或 5），
 * 本组件只按拿到的张数选择下面的布局形态，不做任何截取。
 *
 * 降级规则：
 *   - 5 张：完整 bento（大卡 + 竖排 2 小卡 + 底行 2 宽卡）；
 *   - 3~4 张：只渲染第一行（大卡 + 竖排 2 小卡），多出的第 4 张不展示——
 *     宁可少一张也不凑单卡宽底行；
 *   - 1~2 张：降级为等分一行（高 280，复用 .hm-bento__wide）；
 *   - 0 张：整段不渲染。
 */
/**
 * 三档坑位各自的 `sizes`，按 `.hm-bento__row` 的 flex 比例换算成 vw。
 *
 * `.hm-bento__main`(flex:2) / `.hm-bento__side`(flex:1，内含两张 `__small`) 同一行
 * 三等分，`.hm-bento__wide`(flex:1) 单独一行对半分——容器宽度本身随 `--gut`
 * （16/32/48）跳变、且顶到 `--container-max`（1440）后不再随视口线性增长，
 * 实测（`artifacts/verification/OPT-059/breakpoints-verification.md`，1440
 * 视口、容器 1343px）main 885px / small 442px / wide 663px；反推 768–1439px
 * 视口区间（容器 = vw − 2×32），三档占视口比例分别落在约 60~63vw / 30~31vw /
 * 45~47vw，故取 62 / 32 / 47vw——比实测略宽松一点，报小了会选到糊图（见下），
 * 报大了只是多下一档，故意偏保守。候选只有 320/768/1600 三档：main 在这个
 * vw 比例下于视口约 1280px 处跨过 768px 实际渲染宽度、开始选 1600 档；
 * small/wide 在常见桌面宽度下落在 320~768px 之间，稳定选 768 档，不再像
 * 统一 800px 时那样三档一律选中 1600w（小卡 3.6x、宽卡 2.4x 过采样）。
 * ≤767px 时 `.hm-bento__row` 纵向堆叠、三档卡都是满宽（`home.css:242-245`），
 * 这一段三档可共用 100vw。
 */
const BENTO_SIZES: Readonly<Record<string, string>> = {
  'hm-bento__main': '(max-width: 767px) 100vw, 62vw',
  'hm-bento__small': '(max-width: 767px) 100vw, 32vw',
  'hm-bento__wide': '(max-width: 767px) 100vw, 47vw',
}

function BentoCard({ card, prefix, citySlug, sizeClass }: Readonly<{
  card: DistrictCardViewModel
  prefix: string
  citySlug?: string
  sizeClass: string
}>) {
  return (
    <Link
      // 带城市前缀时指向区域落地页（OPT-119）：这些卡是**商圈**卡，旧链接 `?district=<商圈slug>`
      // 对商圈根本不生效（区域词表里没有它，被静默丢弃后落在未筛选的全城列表）。无前缀（legacy）
      // 没有落地页，保持原筛选页链接。
      href={citySlug ? areaLandingPath(citySlug, card.slug) : `${prefix}/listings?district=${encodeURIComponent(card.slug)}`}
      prefetch={false}
      className={`hm-bento-card ${sizeClass}`}
      data-event-name="home_district_click"
    >
      {card.coverImage ? (
        // decorative：商圈名已是同一卡片内的可见文字，图片不承载额外信息
        // （见 OPT-059 复核）。sizes 按坑位区分，见 BENTO_SIZES 注释。
        <Media media={card.coverImage} ratio="auto" sizes={BENTO_SIZES[sizeClass] ?? '(max-width: 767px) 100vw, 800px'} decorative />
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
          <BentoCard card={main} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__main" />
          <div className="hm-bento__side">
            <BentoCard card={sideA} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__small" />
            <BentoCard card={sideB} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__small" />
          </div>
        </div>
        <div className="hm-bento__row">
          <BentoCard card={wideA} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__wide" />
          <BentoCard card={wideB} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__wide" />
        </div>
      </>
    )
  } else if (cards.length >= 3) {
    const [main, sideA, sideB] = cards
    body = (
      <div className="hm-bento__row">
        <BentoCard card={main} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__main" />
        <div className="hm-bento__side">
          <BentoCard card={sideA} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__small" />
          <BentoCard card={sideB} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__small" />
        </div>
      </div>
    )
  } else {
    body = (
      <div className="hm-bento__row">
        {cards.map((card) => (
          <BentoCard key={card.slug} card={card} prefix={prefix} citySlug={citySlug} sizeClass="hm-bento__wide" />
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
