import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import BackToTop from '@/components/frontend/BackToTop'
import BuildingSummaryCard from '@/components/frontend/BuildingSummaryCard'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import ListingDecisionCard, { buildListingPriceDigest } from '@/components/frontend/detail/ListingDecisionCard'
import ListingOverviewPanel from '@/components/frontend/detail/ListingOverviewPanel'
import type { NoImageMetaItem } from '@/components/frontend/detail/NoImageHeroGrid'
import type { SpecRow } from '@/components/frontend/detail/SpecTable'
import StickyInquiryBar from '@/components/frontend/detail/StickyInquiryBar'
import DetailGallery from '@/components/frontend/DetailGallery'
import DetailMobileBarPrice from '@/components/frontend/DetailMobileBarPrice'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingCard from '@/components/frontend/ListingCard'
import LocationPanel from '@/components/frontend/LocationPanel'
import RecommendationReason from '@/components/frontend/RecommendationReason'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { ListingDetailViewModel } from '@/domain/public-catalog/contracts'
import { DECORATION_STATUS_LABELS } from '@/domain/review/listing-fields'
import { buildListingJsonLd, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { formatAvailableDate } from '@/lib/frontend/format'
import { LISTING_TYPE_LABEL } from '@/lib/frontend/listing-display'
import { siteConfig } from '@/lib/frontend/site-config'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import type { ServiceSchedule } from '@/domain/advisor-availability'
import type { getCachedDetailRecommendations } from '@/lib/frontend/cached-queries'

type RouteMode = 'legacy' | 'prefixed'
type Recommendations = Awaited<ReturnType<typeof getCachedDetailRecommendations>>

/**
 * 房源详情页编排层（OPT-037 Task 9 接线）
 *
 * 设计依据：`docs/SBH设计任务讨论/房源详情.dc.html`，页面顺序取 specRows
 * 「页面顺序」：标题栏 → 核心区（画廊 + 决策卡）+ 概况面板 → 描述 →
 * 周边与交通 → 所在楼盘 → 推荐。
 *
 * 本文件只负责**顺序、容器与数据分发**，每一块的内部结构都在各自组件里
 * （Task 1–8 产出）：`DetailGallery`（含无图替代构图）、`ListingDecisionCard`、
 * `StickyInquiryBar`、`ListingOverviewPanel`、`LocationPanel`、
 * `BuildingSummaryCard`。不要把区块细节搬回来——上一版正是因为卡片 markup 摊在
 * 页面里，"页面顺序"被 40 行 svg 与 dl 淹没。
 *
 * 两条路由（`/listings/[slug]` 与 `/[city]/listings/[slug]`）共用本组件，
 * 差别只有 `routeMode` 决定的 basePath 与 JSON-LD 的 citySlug。
 *
 * 结构性取舍（Task 9 做的两处内容删除，不是漏接线）：
 *   1. **「配套设施」整段移除**。comp 用「周边与交通」替代了原配套设施段
 *      （见 dc.html 该段注释），specRows 的页面顺序里也没有配套设施。逐条核过
 *      移除代价：`listing.amenityGroups` 恒等于
 *      `[{id:'highlights', items: card.highlights}]`（mappers.ts:862），而
 *      `highlights` 契约上「最多三项」且标题栏已经全部展示——旧代码的去重
 *      （seenAmenities 从标题栏三项起手）本就把它整组滤空。真正会消失的只有
 *      **楼盘级**配套（旧代码从 `buildingDetail.amenityGroups` 取），那份数据在
 *      楼盘详情页「楼盘参数 · 楼盘特色」原样存在，本页「所在楼盘」卡片直接链过去。
 *      因为不再需要楼盘详情文档，`buildingDetail` prop 与两条路由里的
 *      `getCachedBuildingBySlug` 取数一并摘除（少一次详情页查询）。
 *   2. **`DetailFacts`（全量事实清单）换成 `ListingOverviewPanel`（概况面板）**。
 *      这是 Task 3 的既定设计：概况面板是按 comp factGroups 逐字段核过可达性的
 *      固定行清单，不是「把 factGroups 全倒出来」。不在清单里的事实（如楼层、
 *      朝向这类 mapper 产出但 comp 未列的行）在本页不再出现——这是设计取舍，
 *      `DetailFacts` 组件本身仍被楼盘详情页使用，没有删。
 */
export default function CityListingDetailView({
  city,
  listing,
  recommendations,
  pois,
  serviceSchedule,
  mapEnabled,
  routeMode,
}: Readonly<{
  city: CityContext
  listing: ListingDetailViewModel
  recommendations: Recommendations
  pois: PoiByCategory
  serviceSchedule?: ServiceSchedule
  mapEnabled: boolean
  routeMode: RouteMode
}>) {
  const basePath = routeMode === 'prefixed' ? `/${city.slug}` : ''
  const listingPath = `${basePath}/listings/${encodeURIComponent(listing.slug)}`
  const building = listing.building
  const media = listing.mediaItems.length > 0
    ? listing.mediaItems
    : listing.gallery.map((resource, index) => ({
        id: `legacy-gallery-${index}-${resource.src}`,
        kind: 'image' as const,
        category: '图片',
        resource,
        capturedAt: null,
        isSchematic: false,
      }))
  // 无图替代构图（OPT-037 Task 2）：六项关键规格逐一核实可达——全部取自
  // ListingDetailViewModel 顶层字段或其 building 子对象，不解析 factGroups
  // 里已拼好 suffix 的字符串（那些是「值嵌单位的键值行」格式，不是这里
  // 要的「大数值 + 独立单位」格式）。地址取 building.address；「交通」
  // comp 原稿要的是「地铁站 + 距离 + 步行时间」，但距离/步行时间只有
  // LocationPanel 消费的 pois（POI 检索结果）里才有，DetailGallery 这一层
  // 拿不到，也不该为了六个字段把整个 POI 依赖搭进来——因此换成可达的
  // 「近 {地铁站名}」，不编造距离与步行时间。
  const noMediaKeySpecs: readonly SpecRow[] = [
    { label: '建筑面积', value: listing.area != null ? String(listing.area) : null, unit: '㎡' },
    { label: '工位数', value: listing.seats != null ? String(listing.seats) : null, unit: '个' },
    {
      label: '装修状态',
      value: listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null,
    },
    { label: '房源类型', value: LISTING_TYPE_LABEL[listing.listingType] },
    // 「可入驻」故意不走本组其余五项的 value ?? '—' 兜底：formatAvailableDate
    // 对缺失统一返回「面议」，是该字段在页面其它位置（概况面板「交付时间」、
    // ListingCard）已经在用的既有展示口径——两套兜底文案在同一个宫格里
    // 并存是有意为之，不是遗漏统一。
    { label: '可入驻', value: formatAvailableDate(listing.availableFrom) },
    { label: '楼盘等级', value: getBuildingGradeLabel(building?.grade) ?? null },
  ]
  // 底条两格（Task 10b 起由调用方装配，见 NoImageHeroGrid 文件头）：房源页
  // 首屏除画廊外只有决策卡（价格/核验/顾问），地址与交通没有第二处出处，
  // 所以照旧放这两格；渲染结果与 Task 2 首版逐字节一致。
  const noMediaMeta: readonly NoImageMetaItem[] = [
    { label: '地址', value: building?.address ?? null },
    { label: '交通', value: building?.nearestMetro?.name ? `近${building.nearestMetro.name}` : null },
  ]

  // 价格摘要只算一次，决策卡与吸附询价条共用（两者是同一个询价入口的两种
  // 呈现形态，文案分叉就是两个事实源）。
  const priceDigest = buildListingPriceDigest(listing)
  // 移动端底栏价格沿用 PriceViewModel.text 整串（既有行为，F-016 起未变）。
  const rentText = listing.price?.text ?? priceDigest.fallbackText
  const inquirySupplyGroup: 'lease' | 'sale' | 'coworking' =
    listing.listingType === 'coworking' ? 'coworking' : listing.businessType
  const inquiryPriceSnapshot = listing.price
    ? {
        amount: listing.price.amount,
        currency: listing.price.currency,
        period: listing.price.period,
        unit: listing.price.displayUnit,
      } as const
    : undefined
  const inquiryCurrentFilters = {
    group: inquirySupplyGroup,
    ...(listing.price ? { priceUnit: listing.price.displayUnit } : {}),
  } as const
  // 询价目标三件套：决策卡 / 吸附条 / 移动底栏三处 InquiryModal 只有
  // sourceSection 与触发器外观不同，目标房源与价格快照必须完全一致。
  const inquiryTarget = {
    pageType: 'listing',
    targetListingSlug: listing.slug,
    targetBuildingSlug: building?.slug,
    targetSummary: listing.title,
    triggerLabel: '询价 / 预约看房',
    priceSnapshot: inquiryPriceSnapshot,
    activeSupplyGroup: inquirySupplyGroup,
    currentFilters: inquiryCurrentFilters,
    serviceSchedule,
  } as const
  const headerHighlights = listing.highlights.slice(0, 3)
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined

  return (
    <div className="dt-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildListingJsonLd(listing, siteConfig.siteOrigin, { citySlug })) }}
      />

      <header className="dt-container dt-titlebar">
        <Breadcrumb
          items={[
            { label: '首页', href: basePath || '/' },
            { label: '办公选址', href: `${basePath}/listings` },
            ...(building?.district ? [{ label: building.district.name }] : []),
            ...(building ? [{ label: building.name, href: `${basePath}/buildings/${encodeURIComponent(building.slug)}` }] : []),
            { label: listing.title },
          ]}
        />
        <div className="dt-titlebar__row">
          <h1 className="dt-titlebar__title">{listing.title}</h1>
          {/* comp 标题栏右侧是「收藏 / 加入对比 / 分享」pill 组；我们有的是
              收藏+分享（ShareSaveActions）与纠错（CorrectionModal），
              「加入对比」功能不存在，不画空按钮。位置与楼盘详情页
              （BuildingDetailLayout 的 .detail-v2__titlebar-actions）一致，
              两个详情页的这排操作不再一个在标题栏、一个在决策卡里。 */}
          <div className="dt-titlebar__actions">
            <ShareSaveActions canonicalUrl={`${siteConfig.siteOrigin}${listingPath}`}
              savedDetail={{ type: 'listing', id: listing.id, slug: listing.slug }} />
            <CorrectionModal targetType="listing" targetSlug={listing.slug} targetSummary={listing.title} />
          </div>
        </div>
        {headerHighlights.length > 0 && (
          <div className="dt-titlebar__tags" aria-label="房源亮点">
            {headerHighlights.map((text) => <span key={text} className="tag">{text}</span>)}
          </div>
        )}
      </header>

      {/* 吸附询价条：`position:fixed`，只有决策卡完全离屏时才由
          StickyInquiryBar 自己挂载（见该组件文件头）。必须挂在全幅块
          `.dt-page` 下、不能进 `.dt-container`（detail.css「吸附栏共享外壳」
          的接线契约）。 */}
      <StickyInquiryBar
        title={listing.title}
        priceText={priceDigest.value}
        priceUnit={priceDigest.unit ?? undefined}
        summaryText={priceDigest.summaryText ?? undefined}
        cta={<InquiryModal {...inquiryTarget} sourceSection="sticky-card" triggerClassName="btn--lg" />}
      />

      <div className="dt-container">
        <div className="dt-core">
          <DetailGallery
            media={media}
            title={listing.title}
            pageType="listing"
            noMediaFallback={{ keySpecs: noMediaKeySpecs, meta: noMediaMeta }}
          />

          <ListingDecisionCard
            digest={priceDigest}
            verification={listing.verification}
            cta={<InquiryModal {...inquiryTarget} sourceSection="hero"
              triggerClassName="btn--lg btn--block dt-decision__cta" />}
            advisor={<AdvisorCard />}
          />

          {/* 概况面板通栏跨两列、落在核心区第 2 行（specRows「tab 区」，租金账
              取消后没有 tab 壳，见 ListingOverviewPanel 文件头）。h2 由本层给：
              comp 那里的「房源概况」是 tab pill 的文字，tab 没了就得有个真标题，
              否则这一整块在无障碍树里没有名字。 */}
          <section id="overview" className="dt-overview-block">
            <h2 className="dt-h2">房源概况</h2>
            <ListingOverviewPanel listing={listing} />
          </section>
        </div>
      </div>

      {listing.description && (
        <section id="description" className="dt-container dt-section">
          <h2 className="dt-h2">房源描述</h2>
          <div className="richtext dt-richtext"><RichText data={listing.description} /></div>
        </section>
      )}

      {/* 周边与交通：LocationPanel 自带 <section id="location"> 与 h2，
          无坐标时整段返回 null（Task 5 的硬约束）——所以这里不能再套一层
          带 padding 的 wrapper，否则无坐标房源会多出一段空白。容器宽度由
          detail.css 的 `.dt-page .location-panel` 直接给。 */}
      {building && <LocationPanel building={{ id: building.id, name: building.name, address: building.address,
        coordinates: building.coordinates, nearestMetro: building.nearestMetro ? { name: building.nearestMetro.name } : undefined }}
        pois={pois} mapEnabled={mapEnabled} />}

      {building && (
        <section id="building" className="dt-container dt-section">
          <h2 className="dt-h2">所在楼盘</h2>
          <BuildingSummaryCard building={building} listingId={listing.id} citySlug={citySlug} />
        </section>
      )}

      {recommendations.length > 0 && (
        <section id="related" className="dt-container dt-section">
          <h2 className="dt-h2">相关推荐</h2>
          <div className="card-grid">
            {recommendations.map((rec, index) => (
              <div key={rec.card.id} className="recommendation-card-wrapper">
                <ListingCard listing={rec.card} citySlug={citySlug} detailAnalytics={{ event: 'recommendation_click',
                  parentId: listing.id, rank: index + 1, section: 'related', recommendationType: 'contextual' }} />
                <RecommendationReason reasonCodes={rec.reasonCodes} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info">
          {/* 底栏价格的观察锚点从 `.detail__rent`（已随旧首屏摘要一起消失）
              换成决策卡本体：移动端决策卡是普通文档流里的一块，滚出视口即
              代表"页内价格已不可见"，与旧锚点表达的是同一件事。 */}
          <DetailMobileBarPrice rentText={rentText} anchorSelector=".dt-decision" />
          <span className="detail__mobile-bar-title">{listing.title}</span>
        </div>
        <InquiryModal {...inquiryTarget} sourceSection="mobile-bar" />
      </div>

      <BackToTop />
      <DetailClickAnalytics />
    </div>
  )
}
