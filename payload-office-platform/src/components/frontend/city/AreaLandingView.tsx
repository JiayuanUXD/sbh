import Link from 'next/link'
import React from 'react'
import ArticleCard from '@/components/frontend/ArticleCard'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
import { Breadcrumb, type BreadcrumbItem } from '@/components/frontend/ui/Breadcrumb'
import { areaLandingPath, buildAreaLandingCopy, summarizeAreaPrice } from '@/domain/public-catalog/area-landing'
import type { AreaLandingEntry, AreaLandingPage } from '@/domain/public-catalog/area-landing-facade'
import { formatPublishedDate } from '@/lib/frontend/format'

/**
 * 区域 / 商圈落地页视图（OPT-119）。
 *
 * Server Component，只消费 `AreaLandingPage`（统计行 + 热门楼盘 + 资讯 DTO）。
 * 所有数字来自统计行；缺失就不渲染对应区块，不显示 0、不编造（价格区块要求
 * `summarizeAreaPrice` 通过样本门槛）。样式在 `styles/area.css`（`.al-*`）。
 */

type Props = Readonly<{
  city: Readonly<{ slug: string; name: string }>
  page: AreaLandingPage
}>

const count = (value: number) => value.toLocaleString('en-US')
const price = (value: number) => value.toFixed(2)

const KIND_LABEL = { district: '行政区', business_area: '商圈' } as const

function AreaLinkCard({ area, citySlug }: Readonly<{ area: AreaLandingEntry; citySlug: string }>) {
  const priceSummary = summarizeAreaPrice(area)
  return (
    <Link href={areaLandingPath(citySlug, area.slug)} className="sf-card al-area-card">
      <span className="al-area-card__name">{area.name}</span>
      <span className="al-area-card__meta sf-num">{count(area.listingCount)} 套在租 · {count(area.buildingCount)} 栋写字楼</span>
      {priceSummary && (
        <span className="al-area-card__price sf-num">中位 {price(priceSummary.median)} 元/㎡/天</span>
      )}
    </Link>
  )
}

export default function AreaLandingView({ city, page }: Props) {
  const { entry, parent, childAreas, siblingAreas, price: priceSummary, topBuildings, articles } = page
  const isDistrict = entry.kind === 'district'
  const hasSupply = entry.listingCount > 0
  const copy = buildAreaLandingCopy({
    cityName: city.name,
    location: { kind: entry.kind, name: entry.name, description: entry.description },
    parentName: parent?.name ?? entry.parentName,
    stats: entry,
    topBuildings: topBuildings.map((building) => ({ name: building.name, listingCount: building.listingCount ?? 0 })),
    childAreas: childAreas.map((area) => ({ name: area.name, listingCount: area.listingCount })),
  })

  const breadcrumb: BreadcrumbItem[] = [{ label: '首页', href: '/' }, { label: city.name, href: `/${city.slug}` }]
  if (parent) breadcrumb.push({ label: parent.name, href: areaLandingPath(city.slug, parent.slug) })
  breadcrumb.push({ label: entry.name })

  // 筛选入口：行政区走 ?district=，商圈走 ?businessArea=（两个参数不通用，见 OPT-119 §1）。
  const filterQuery = `${isDistrict ? 'district' : 'businessArea'}=${encodeURIComponent(entry.slug)}`
  const listingsHref = `/${city.slug}/listings?${filterQuery}`
  const buildingsHref = `/${city.slug}/buildings?${filterQuery}`
  const updatedAt = formatPublishedDate(entry.lastUpdatedAt)
  const relatedAreas = isDistrict ? childAreas : siblingAreas

  return (
    <div className="al-page">
      <Breadcrumb items={breadcrumb} />

      <header className="al-hero">
        <p className="al-hero__eyebrow">{city.name}{KIND_LABEL[entry.kind]}</p>
        <h1 className="al-hero__title">{entry.name}写字楼出租</h1>
        {hasSupply ? (
          <>
            <p className="al-hero__lead">{copy.intro}</p>
            <dl className="al-stats">
              <div className="al-stats__item">
                <dt>在租房源</dt>
                <dd className="sf-num"><strong>{count(entry.listingCount)}</strong> 套</dd>
              </div>
              <div className="al-stats__item">
                <dt>在租写字楼</dt>
                <dd className="sf-num"><strong>{count(entry.buildingCount)}</strong> 栋</dd>
              </div>
              {priceSummary && (
                <div className="al-stats__item">
                  <dt>租金中位数（挂牌价）</dt>
                  <dd className="sf-num"><strong>{price(priceSummary.median)}</strong> 元/㎡/天</dd>
                </div>
              )}
            </dl>
            {updatedAt && <p className="al-hero__note sf-num">房源数据更新于 {updatedAt}</p>}
          </>
        ) : (
          <>
            <p className="al-hero__lead">{entry.name}暂无在租房源。你可以先看看{city.name}全部在租房源，或留下需求让顾问帮你找。</p>
            <div className="al-cta">
              <Link href={`/${city.slug}/listings`} className="al-cta__link" prefetch={false}>查看{city.name}全部在租房源</Link>
              <Link href={`/${city.slug}/buildings`} className="al-cta__link" prefetch={false}>浏览{city.name}写字楼</Link>
            </div>
          </>
        )}
      </header>

      {hasSupply && priceSummary && (
        <section className="al-section" aria-labelledby="al-price">
          <h2 id="al-price" className="hm-h2">{entry.name}办公室租金参考</h2>
          <div className="dt-panel dt-panel--full al-price">
            <dl className="al-price__grid">
              <div>
                <dt>常见区间</dt>
                <dd className="sf-num"><strong>{price(priceSummary.p25)}–{price(priceSummary.p75)}</strong> 元/㎡/天</dd>
              </div>
              <div>
                <dt>中位数</dt>
                <dd className="sf-num"><strong>{price(priceSummary.median)}</strong> 元/㎡/天</dd>
              </div>
              <div>
                <dt>最低 – 最高</dt>
                <dd className="sf-num"><strong>{price(priceSummary.min)}–{price(priceSummary.max)}</strong> 元/㎡/天</dd>
              </div>
              <div>
                <dt>100㎡ 月租估算</dt>
                <dd className="sf-num"><strong>¥{count(priceSummary.monthlyFor100Sqm.median)}</strong> /月</dd>
              </div>
            </dl>
            <p className="al-price__note sf-num">
              基于 {count(priceSummary.sampleCount)} 套按「元/㎡/天」报价的在租房源挂牌价，常见区间为 P25–P75（中间一半房源的报价范围），不是成交价。
              月租估算 = 日单价 × 100㎡ × 30 天（区间 ¥{count(priceSummary.monthlyFor100Sqm.low)}–¥{count(priceSummary.monthlyFor100Sqm.high)}），未含物业费、停车费等。
              {entry.otherUnitCount > 0 ? `另有 ${count(entry.otherUnitCount)} 套按其他单位或面议报价，因单位不可换算，未计入。` : ''}
            </p>
          </div>
        </section>
      )}

      {relatedAreas.length > 0 && (
        <section className="al-section" aria-labelledby="al-areas">
          <h2 id="al-areas" className="hm-h2">{isDistrict ? `${entry.name}主要商圈` : `${parent?.name ?? '同区'}其他商圈`}</h2>
          <div className="al-area-grid">
            {relatedAreas.map((area) => (
              <AreaLinkCard key={area.slug} area={area} citySlug={city.slug} />
            ))}
          </div>
        </section>
      )}

      {topBuildings.length > 0 && (
        <section className="al-section" aria-labelledby="al-buildings">
          <h2 id="al-buildings" className="hm-h2">{entry.name}热门楼盘</h2>
          <div className="al-building-grid">
            {topBuildings.map((building) => (
              <BuildingResultCard key={building.slug} building={building} citySlug={city.slug} />
            ))}
          </div>
        </section>
      )}

      {articles.length > 0 && (
        <section className="al-section" aria-labelledby="al-news">
          <h2 id="al-news" className="hm-h2">{entry.name}相关资讯</h2>
          <div className="article-grid">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      )}

      {hasSupply && (
        <section className="al-section" aria-labelledby="al-faq">
          <h2 id="al-faq" className="hm-h2">常见问题</h2>
          <div className="dt-panel dt-panel--full">
            <dl className="al-faq">
              {copy.faq.map((item) => (
                <div key={item.question} className="al-faq__item">
                  <dt className="al-faq__q">{item.question}</dt>
                  <dd className="al-faq__a">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {hasSupply && (
        <nav className="al-cta" aria-label={`${entry.name}房源入口`}>
          <Link href={listingsHref} className="al-cta__link" prefetch={false}>查看{entry.name}全部 {count(entry.listingCount)} 套在租房源</Link>
          <Link href={buildingsHref} className="al-cta__link" prefetch={false}>浏览{entry.name}全部写字楼</Link>
        </nav>
      )}
    </div>
  )
}
