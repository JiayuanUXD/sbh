import Link from 'next/link'

import InquiryModal from '@/components/frontend/InquiryModal'
import ListingResultCard from '@/components/frontend/listing/ListingResultCard'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
import type { SearchFallback } from '@/lib/frontend/cached-queries'

/**
 * 全局零结果页。
 *
 * 回答三个问题：是不是打错了（建议）、这里到底有没有（实体卡）、还能看什么
 * （热门区域 / 热门楼盘 / 推荐房源）。浏览块最多三个；实体卡存在时占掉楼盘块，
 * 不把页面堆成推荐货架。
 *
 * 热门内容与 q 无关，按城市缓存；这里只做投影，不再取数。
 */
export default function SearchZeroState({
  basePath,
  citySlug,
  q,
  fallback,
  suggestions,
  entity,
}: Readonly<{
  basePath: string
  citySlug: string
  q: string
  fallback: SearchFallback
  suggestions: readonly string[]
  entity: Readonly<{ name: string; slug: string }> | null
}>) {
  const suggestionHref = (value: string) => `${basePath}?q=${encodeURIComponent(value)}`

  return (
    <section className="sw-zero" aria-labelledby="sw-zero-title">
      <h2 id="sw-zero-title" className="sw-zero__title">没有找到「{q}」相关的内容</h2>

      {suggestions.length > 0 ? (
        <div className="sw-zero__suggest">
          <span>你是不是想找：</span>
          <ul>
            {suggestions.map((value) => (
              <li key={value}>
                <Link href={suggestionHref(value)}>{value}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sw-zero__blocks">
        {entity ? (
          <div className="sw-zero__entity">
            <span className="sw-zero__entity-name">{entity.name}</span>
            <span className="sw-zero__entity-note">该楼盘暂无在租房源</span>
            <Link href={`/${citySlug}/buildings/${entity.slug}`}>查看楼盘 →</Link>
          </div>
        ) : null}

        {fallback.districts.length > 0 ? (
          <div className="sw-zero__block">
            <h3>热门区域</h3>
            <ul className="sw-districts">
              {fallback.districts.map((district) => (
                <li key={district.slug}>
                  <Link href={`/${citySlug}/area/${district.slug}`}>
                    {district.name}
                    <span>{district.count} 套</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!entity && fallback.buildings.length > 0 ? (
          <div className="sw-zero__block">
            <h3>热门楼盘</h3>
            <div className="sw-zero__grid">
              {fallback.buildings.slice(0, 4).map((building) => (
                <BuildingResultCard key={building.slug} building={building} citySlug={citySlug} />
              ))}
            </div>
          </div>
        ) : null}

        {fallback.listings.length > 0 ? (
          <div className="sw-zero__block">
            <h3>推荐房源</h3>
            <div className="sw-zero__grid">
              {fallback.listings.slice(0, 4).map((listing) => (
                <ListingResultCard key={listing.slug} listing={listing} citySlug={citySlug} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="sw-zero__cta">
        <p>没找到合适的？告诉我们需求，顾问帮你找。</p>
        <InquiryModal pageType="search" triggerLabel="提交找房需求" triggerVariant="primary" />
      </div>
    </section>
  )
}
