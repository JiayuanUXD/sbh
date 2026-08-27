import Link from 'next/link'
import React from 'react'
import { Media } from '@/components/frontend/ui/Media'
import type { HomepageTypeSummary } from '@/domain/public-catalog/contracts'

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
  /** 来自「站点设置 → 首页区块」。只带文案与顺序，跳转目标查 SLOT_TARGETS。 */
  cards: readonly Readonly<{ slot: string; label: string; sublabel: string | null }>[]
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
                    {summary?.cover ? (
                      // 类型卡图区固定 168px 高，三段布局需要各报各的坑位宽：
                      // ≤767px 时 home.css:213 把图元素 display:none，但主流浏览器
                      // 对 display:none 的图片元素仍会发起请求——真正让移动端不下载
                      // 大图的是 sizes 报的 0px 让浏览器选最小档，属无害的副作用，
                      // 不是 display:none 本身省流量。768–1023px 时 home.css:199 把
                      // .hm-types 变两列（图仍显示），坑位约容器一半宽，用 50vw
                      // 近似；≥1024px 桌面五等分（1440 视口下约 229px 宽），320w
                      // 档够用。
                      // decorative：类型名/在租套数已是可见文字，图片不承载额外信息，
                      // 不能让读屏用户听到某条具体房源的标题（见 OPT-059 复核）。
                      <Media media={summary.cover} ratio="auto" sizes="(max-width: 767px) 0px, (max-width: 1023px) 50vw, 320px" decorative />
                    ) : null}
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
