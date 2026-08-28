import Link from 'next/link'
import React from 'react'
import { Media } from '@/components/frontend/ui/Media'
import type { HomepageTypeSummary, MediaViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页「按类型浏览」图卡（五等分 1fr×300 · 图高 168）。
 *
 * 封面与计数来自 typeSummaries（key 为 listingType）。创意园区无 listingType，
 * 封面与计数行都省略——不编造数据。
 *
 * ## OPT-053：文案可配，跳转不可配
 *
 * `href` / `type` / 埋点名由**槽位**决定，查下面这张表；运营只能改 label、
 * sublabel、显隐与顺序。开放 href 就是开放死链——它绑定 `Listings.listingType`
 * 枚举，填错不会 404 而是返回空结果页，比 404 更难发现。
 *
 * 槽位必须**逐行持久化**，不能靠数组下标绑定：运营一拖拽调序，「联合办公」这张卡
 * 就会链到传统办公——标题和副标题都是对的，只有链接错，页面上完全看不出来。
 */
const SLOT_TARGETS: Readonly<Record<string, Readonly<{ href: string; type: string | null; event: string }>>> = {
  'traditional-office': { href: '/listings?type=traditional-office', type: 'traditional-office', event: 'home_cat_traditional' },
  'coworking': { href: '/listings?type=coworking', type: 'coworking', event: 'home_cat_coworking' },
  'full-floor': { href: '/listings?type=full-floor', type: 'full-floor', event: 'home_cat_full_floor' },
  'serviced-office': { href: '/listings?type=serviced-office', type: 'serviced-office', event: 'home_cat_standalone' },
  'creative-park': { href: '/buildings', type: null, event: 'home_cat_creative_park' },
}

export default function HomeTypeCards({ typeSummaries, citySlug, cards }: Readonly<{
  typeSummaries: Readonly<Record<string, HomepageTypeSummary>>
  citySlug?: string
  /** 来自「站点设置 → 首页区块」，已由 resolveTypeCardCovers 盖过单城覆盖。跳转目标查 SLOT_TARGETS。 */
  cards: readonly Readonly<{
    slot: string
    label: string
    sublabel: string | null
    coverImage: MediaViewModel | null
  }>[]
}>) {
  const prefix = citySlug ? `/${citySlug}` : ''
  return (
    <section className="hm-section" aria-labelledby="hm-types-title">
      <div className="hm-container">
        <div className="hm-section-head">
          <h2 className="hm-h2" id="hm-types-title">按类型浏览</h2>
          <Link href={`${prefix}/listings`} prefetch={false} className="hm-section-link" data-event-name="home_cat_view_all">查看全部房源 →</Link>
        </div>
        <ul className="hm-types" role="list">
          {cards.map((card, index) => {
            // 槽位查不到就整张卡不渲染：那意味着配置里出现了代码不认识的槽位
            // （比如枚举改名而配置没跟上）。宁可少一张，也不要渲染一个跳不对的入口。
            const target = SLOT_TARGETS[card.slot]
            if (!target) return null
            const summary = target.type ? typeSummaries[target.type] : undefined
            const no = String(index + 1).padStart(2, '0')
            return (
              <li key={card.slot}>
                <Link href={`${prefix}${target.href}`} prefetch={false} className="sf-card hm-type-card" data-event-name={target.event}>
                  <span className="sf-media hm-type-card__media">
                    {(() => {
                      // OPT-060 四级优先级的后两级在这里收口：
                      //   card.coverImage 已经是「城市覆盖 → 全局默认」的结果；
                      //   都为空才回落到该类型首条房源的封面（现状行为），再空则无图。
                      const cover = card.coverImage ?? summary?.cover ?? null
                      return cover ? (
                        // 类型卡图区固定 168px 高、桌面五等分（1440 视口下约 229px 宽）；
                        // 768–1023px 是两列（约 350–480px 宽）；≤767px 图整个 display:none。
                        <Media media={cover} ratio="auto" sizes="(max-width: 767px) 0px, (max-width: 1023px) 50vw, 320px" decorative />
                      ) : null
                    })()}
                    <span className="sf-scrim" aria-hidden="true" />
                    <span className="hm-type-card__no sf-num">{no}</span>
                  </span>
                  <span className="hm-type-card__body">
                    <span className="hm-type-card__name">{card.label}</span>
                    <span className="hm-type-card__sub">{card.sublabel}</span>
                    {summary && summary.count > 0
                      ? <span className="hm-type-card__count sf-num">{summary.count.toLocaleString('en-US')} 套在租</span>
                      : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
