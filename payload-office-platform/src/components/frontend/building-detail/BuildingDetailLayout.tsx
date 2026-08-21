import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'
import BackToTop from '@/components/frontend/BackToTop'
import BuildingCardMini from '@/components/frontend/BuildingCardMini'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import AnchorNavBar, { type AnchorNavItem } from '@/components/frontend/detail/AnchorNavBar'
import BuildingSpecPanel, {
  buildBuildingSpecGroups,
} from '@/components/frontend/detail/BuildingSpecPanel'
import { completionYearFromGroups } from '@/components/frontend/detail/fact-lookup'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailGallery from '@/components/frontend/DetailGallery'
import InquiryModal from '@/components/frontend/InquiryModal'
import LocationPanel from '@/components/frontend/LocationPanel'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { siteConfig } from '@/lib/frontend/site-config'
import DetailSideRail from './DetailSideRail'
import HeroSummaryPanel from './HeroSummaryPanel'
import {
  buildBuildingNoMediaKeySpecs,
  buildBuildingNoMediaMeta,
} from './no-media-fallback'
import NearbyBuildingsStrip from './NearbyBuildingsStrip'
import { aggregateAreaRange } from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 楼盘详情页编排层（OPT-037 Task 10 接线）
 *
 * 设计依据：`docs/SBH设计任务讨论/楼盘详情.dc.html`，页面顺序取稿子正文的区块
 * 次序：吸附锚点条 → 标题栏 → 核心区（主图 + 信息面板）→ 在租房源 →
 * 周边与交通 → 楼盘参数 → 同商圈楼盘。
 *
 * 本文件只负责**顺序、容器与数据分发**，每一块的内部结构在各自组件里
 * （Task 2–8 产出）：`DetailGallery` / `HeroSummaryPanel` / `BuildingSupplyBrowser` /
 * `LocationPanel` / `BuildingSpecPanel` / `AnchorNavBar`。与房源详情页
 * （`CityListingDetailView`）共用同一套 `.dt-page` / `.dt-container` / `.dt-core` /
 * `.dt-section` 骨架类，两页的纵向节奏与容器宽度因此只有一份定义。
 *
 * ── 吸附锚点条的两条接线契约（AnchorNavBar.tsx 与 detail.css 都写了同一份） ──
 *   1. **`items` 由本层按区块「真实渲染与否」装配，不得硬编码 4 项**：无坐标
 *      → 无 `#location`（`LocationPanel` 自己返回 null）、无同商圈楼盘 →
 *      无 `#related`、参数全空 → 无 `#params`。硬编码会产出指向不存在元素的
 *      死锚点。
 *   2. **本条的 sticky 包含块必须覆盖全部被锚点指向的区块**：所以它与四个
 *      区块**都是 `.dt-page` 的直接子元素**，`.dt-page` 就是包含块。不要把它
 *      塞进任何 wrapper（哪怕只是为了加个 padding）——包含块比区块集合短，
 *      条会在还有区块没读完时脱附。同理它必须待在全幅块下：`.dt-bar` 的
 *      毛玻璃与底线要横贯视口，`.dt-page` 的 100vw 出血提供这个全幅。
 *
 * ── `#supply` 为什么**不**随「三组全空」一起消失 ────────────────────────────
 * 本批硬约束是「空态整段不渲染」，但它针对的是**空货架**（一个标题下面什么
 * 都没有），不是**诚实的空态说明**。楼盘没有公开供给时这一段渲染的是
 * 「当前暂无公开可选空间」+ 侧栏的需求登记入口，那是这页最该说的一句话，
 * 而不是一个空壳：
 *   - `BuildingSupplyBrowser` 自己在 `availableGroups.length === 0` 时就渲染
 *     这条文案（Task 7 定的，不是本层新加的兜底）；
 *   - `tests/e2e/detail-pages.spec.ts`「empty-building exposes the
 *     no-public-supply state」正锁着这条文案可见 + hero「登记找房需求」可点；
 *   - Task 7 审查修正专门修过「筛到空结果变成死路」，同一条产品判断。
 * 因此 `#supply` 恒渲染、恒在 `items` 里。真正会缺席的是另外三项。
 */
type BuildingDetailLayoutProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  relatedBuildings: readonly BuildingSummaryViewModel[]
  serviceSchedule?: ServiceSchedule
  pois: PoiByCategory
  mapEnabled: boolean
  citySlug?: string
  /**
   * 供给密度表的组切换 / 筛选 / 排序 canonical query string（不含 `?`），由页面层
   * `parseBuildingSupplySearchParams` 解析后再经 `buildBuildingSupplyCanonicalSearchParams`
   * 序列化而来——非法/过期参数不会被带着走一遍。`BuildingSupplyBrowser` 是
   * 'use client'，URLSearchParams 实例不能安全跨 Server→Client 边界传递，
   * 因此在这里降格为纯字符串（同 OPT-036 `FilterFormC` 系列的 basePath +
   * currentParams 传参约定，只是 currentParams 换成了字符串形态）。
   */
  supplyCurrentSearch: string
}>

export default function BuildingDetailLayout({
  building,
  supply,
  relatedBuildings,
  serviceSchedule,
  pois,
  mapEnabled,
  citySlug,
  supplyCurrentSearch,
}: BuildingDetailLayoutProps) {
  const visibleRelatedBuildings = relatedBuildings.filter((item) => item.id !== building.id)
  const hasRelated = visibleRelatedBuildings.length > 0
  // `#location` 的渲染条件必须与 `LocationPanel` 内部的 `if (!coordinates) return null`
  // 一字一句对齐——两边不一致就会出现「锚点在、区块不在」（死锚点）或
  // 「区块在、锚点不在」（导航漏一项）。这是本层唯一复制了组件内部条件的地方，
  // 因为 Server Component 无法在渲染前询问子组件「你会不会返回 null」。
  const hasLocation = building.coordinates != null

  // 「最小可租面积」与 `HeroSummaryPanel` 的「可租面积」统计同源（同一个
  // aggregateAreaRange），不另算一份；无有效供给时是 null 而不是 0。
  const minLeasableArea = aggregateAreaRange(supply.availableGroups)?.min ?? null
  const specInput = { factGroups: building.factGroups, amenityGroups: building.amenityGroups }
  // 「整段不渲染」的判据落在**最终会不会有内容**上：`BuildingSpecPanel` 的四组
  // 是固定行清单（缺值渲染 —，不隐藏行，Task 6 的既定契约），所以「这栋楼一条
  // 参数都没有」时它会渲染 19 行 — ——那是空货架，不是诚实空态。这里复用同一个
  // 导出的纯函数判断，不在页面层另写一套「哪些字段算参数」的逻辑
  // （多算一次纯函数，换掉一份会漂移的重复判断）。
  const hasSpecValues = buildBuildingSpecGroups(specInput, minLeasableArea).some((group) =>
    group.rows.some((row) => row.value != null),
  )
  const hasFeatures = building.amenities.length > 0
  const hasDescription = Boolean(building.description)
  // 参数面板与介绍段是两块内容，判据必须分开：`|| hasDescription` 曾一起挂在
  // 面板的渲染条件上，于是「只填了富文本简介、参数与特色全空」的楼盘照样渲染
  // 那 19 行「—」——正是上面这段注释自己定义的空货架。介绍段有内容不构成
  // 「这栋楼有参数」。
  const hasSpecPanel = hasSpecValues || hasFeatures
  // `#params` 区段（及其锚点）只要两块里有一块有内容就渲染：只有简介时它承载
  // 的是「楼盘介绍」这段真实内容，不是空壳。
  const hasParams = hasSpecPanel || hasDescription

  const basePath = citySlug ? `/${citySlug}` : ''
  const buildingPagePath = `${basePath}/buildings/${encodeURIComponent(building.slug)}`
  const canonicalUrl = `${siteConfig.siteOrigin}${buildingPagePath}`

  // comp 标题栏副标：「静安区南京西路 1515 号 · 甲级写字楼 · 2013 年竣工」。
  // 三段各自判空（站内既有的 join(' · ') 列表转字符串约定），一段都没有时
  // 整行不渲染，不留一个只剩分隔点的空副标。
  const completionYear = completionYearFromGroups(building.factGroups)
  const subtitleParts = [
    building.address,
    getBuildingGradeLabel(building.grade),
    completionYear ? `竣工 ${completionYear}` : null,
  ].filter((part): part is string => Boolean(part))

  // 无图替代构图（Task 10b）：本地库实测所有楼盘 mediaItems 都是 0 条，这条
  // 分支才是常态而不是异常。选了哪六格、底条为什么不是「地址 / 交通」，以及
  // 为什么不许"按稿子补回"总建筑面积/竣工年份/层高，全部写在
  // `no-media-fallback.ts`（那份清单有测试锁着）。
  const noMediaKeySpecs = buildBuildingNoMediaKeySpecs(building)
  const noMediaMeta = buildBuildingNoMediaMeta(building)

  const anchorItems: AnchorNavItem[] = [
    { id: 'supply', label: '在租房源' },
    ...(hasLocation ? [{ id: 'location', label: '周边与交通' }] : []),
    ...(hasParams ? [{ id: 'params', label: '楼盘参数' }] : []),
    ...(hasRelated ? [{ id: 'related', label: '同商圈楼盘' }] : []),
  ]

  return (
    <div className="dt-page">
      <AnchorNavBar
        title={building.name}
        items={anchorItems}
        cta={
          <InquiryModal
            pageType="building"
            targetBuildingSlug={building.slug}
            targetSummary={building.name}
            triggerLabel="预约看房"
            // 'sticky-card'：inquiry schema 没有「顶部吸附条」枚举，且本入口
            // 与页面其它询价入口本就是同一个产品位的不同呈现形态，不为区分
            // 而新造枚举（同 StickyInquiryBar / dev-story 预览的取值）。
            sourceSection="sticky-card"
            serviceSchedule={serviceSchedule}
          />
        }
      />

      <header className="dt-container dt-titlebar">
        <Breadcrumb
          items={[
            { label: '首页', href: basePath || '/' },
            { label: '办公选址', href: `${basePath}/listings` },
            ...(building.district ? [{ label: building.district.name }] : []),
            { label: building.name },
          ]}
        />
        <div className="dt-titlebar__row">
          <h1 className="dt-titlebar__title">{building.name}</h1>
          <div className="dt-titlebar__actions">
            <ShareSaveActions
              canonicalUrl={canonicalUrl}
              savedDetail={{ type: 'building', id: building.id, slug: building.slug }}
            />
            <CorrectionModal
              targetType="building"
              targetSlug={building.slug}
              targetSummary={building.name}
            />
          </div>
        </div>
        {subtitleParts.length > 0 && (
          <p className="dt-titlebar__subtitle">{subtitleParts.join(' · ')}</p>
        )}
      </header>

      <div className="dt-container">
        <div className="dt-core">
          <DetailGallery
            media={building.mediaItems}
            title={building.name}
            pageType="building"
            noMediaFallback={{ keySpecs: noMediaKeySpecs, meta: noMediaMeta }}
          />
          <HeroSummaryPanel
            building={building}
            supply={supply}
            serviceSchedule={serviceSchedule}
          />
        </div>
      </div>

      {/* `data-supply-as-of` 留在本段外层：e2e「供给聚合和列表使用同一 asOf
          快照」用 `[data-supply-as-of]` 的第一个元素与
          `.building-supply-browser[data-supply-as-of]` 对比，两者必须同源。 */}
      <section
        id="supply"
        className="dt-container dt-section dt-anchor-target"
        data-supply-as-of={supply.asOf}
      >
        <div className="dt-sectionhead">
          <h2 className="dt-h2">在租房源</h2>
          {/* comp 副标是快照口径说明，不是又一份统计数字：起价 / 可租面积 /
              套数在本页已经出现两次（信息面板 + 供给区聚合行），旧
              `SupplySectionSummary` 是第三份，接线时并掉。 */}
          <p className="dt-sectionhead__note">同一时刻生成的一份快照，组内数字互相可比</p>
        </div>
        <BuildingSupplyBrowser
          snapshot={supply}
          buildingId={building.id}
          citySlug={citySlug}
          basePath={buildingPagePath}
          currentSearch={supplyCurrentSearch}
        />
        {/* `DetailSideRail` 从「密度表右侧的粘性栏」改成「密度表下方的通栏
            卡片带」。理由是量出来的，不是偏好：comp 的供给行网格是
            `1fr / 130 / 150 / 176 / 120 / 44`，首列约 496，合计 1116 =
            容器 1180 − 面板 padding 32×2；而本版页面容器已按 comp 收到 1180
            （全批次统一），再切走一条 300–372 的右栏，数值列只剩 79–103px，
            实测「2800 元/工位/月」「2026年10月15日」会在单元格里**拦腰折行**
            （截图 task10-main-supply-1440.png 的初版）。改版前它没暴露，是
            因为旧页面根本没有 1180 容器（`.site-main` 1392 − 右栏 300 = 1068，
            够用）。所以「1180 容器」与「300 右栏」二者不可兼得，comp 选了前者。
            只有 `position: sticky` 这个纯呈现属性因换位失效（见 detail.css
            `.dt-page .detail-side-rail`）。
            Task 11 / 11b 把这条带从四张卡收敛成**一张**（详见 DetailSideRail
            文件头）：先摘「热门楼盘」（与 `NearbyBuildingsStrip` /`#related`
            同源，实测同一楼盘一页出现三次），再摘「楼盘摘要」「免费咨询」
            （与核心区 `HeroSummaryPanel` 是同一份内容的第二次呈现——同一个
            起价、同一个供给套数、同一张 AdvisorCard）。剩下的「找房需求登记」
            是本页唯一独有的产品面，改成横贯整宽的一条留资带。
            埋点未丢：摘掉的实例用的 `sourceSection='sticky-card'` 在本页仍有
            `AnchorNavBar` 与本组件两个承载元素。 */}
        <DetailSideRail building={building} serviceSchedule={serviceSchedule} />
      </section>

      {/* 周边与交通：`LocationPanel` 自带 `<section id="location">` 与 h2，
          无坐标时整段返回 null——所以这里**不能**再套一层带 padding 的 wrapper
          （旧 `.detail-v2__location-band` 就是那样，无坐标楼盘会留下一段空白，
          且它的 `.location-panel > h2 { display:none }` 把「周边与交通」这个
          标题整个藏了，锚点跳过去看不到自己跳到了哪）。容器宽度与纵向节奏
          由 detail.css 的 `.dt-page .location-panel` 直接给，`scroll-margin-top`
          也在那条规则里与 `.dt-anchor-target` 同源。 */}
      <LocationPanel
        building={{
          id: building.id,
          name: building.name,
          address: building.address,
          coordinates: building.coordinates,
          nearestMetro: building.nearestMetro
            ? { name: building.nearestMetro.name }
            : undefined,
        }}
        pois={pois}
        mapEnabled={mapEnabled}
      />

      {/* 周边楼盘横滑条带：既有行为，保留。它跟着「周边与交通」走（地理邻近
          语义），因此放在 `#location` 之后、`#params` 之前；自身不做锚点目标
          （仓库里没有指向它的导航引用）。空列表时组件返回 null，所以外层
          `hasRelated` 守卫与它一致，避免留下一段空 padding。 */}
      {hasRelated && (
        <div className="dt-container dt-section dt-nearby">
          <NearbyBuildingsStrip buildings={visibleRelatedBuildings} citySlug={citySlug} />
        </div>
      )}

      {hasParams && (
        <section id="params" className="dt-container dt-section dt-anchor-target">
          <h2 className="dt-h2">楼盘参数</h2>
          {hasSpecPanel && (
            <BuildingSpecPanel
              building={specInput}
              minLeasableArea={minLeasableArea}
              features={building.amenities}
            />
          )}
          {building.description && (
            <div className="dt-params__intro">
              {/* 稿子的楼盘参数区没有富文本介绍段，但站内这份数据是真实存在
                  且商户在后台填的，删掉是内容丢失；放在参数面板之后、同一段
                  之内。标题用「楼盘介绍」而不是旧版的「楼盘特色」——后者现在
                  是面板内那排标签的名字，同页两块同名会读不出区别。 */}
              <h3 className="dt-h3">楼盘介绍</h3>
              <div className="richtext dt-richtext">
                <RichText data={building.description} />
              </div>
            </div>
          )}
        </section>
      )}

      {hasRelated && (
        <section id="related" className="dt-container dt-section dt-anchor-target">
          {/* 标题从旧版「猜你喜欢」改成 comp 的「同商圈楼盘」：这批楼盘来自
              `getRelatedBuildings`（同商圈 / 邻近），不是个性化推荐，旧标题
              对数据来源是误述。锚点文案与它保持一致。 */}
          <h2 className="dt-h2">同商圈楼盘</h2>
          <div className="dt-related-grid">
            {visibleRelatedBuildings.map((item, index) => (
              <BuildingCardMini
                key={item.id}
                building={item}
                parentId={building.id}
                rank={index + 1}
                citySlug={citySlug}
              />
            ))}
          </div>
        </section>
      )}

      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info">
          <span className="detail__mobile-bar-title">{building.name}</span>
        </div>
        <InquiryModal
          pageType="building"
          targetBuildingSlug={building.slug}
          targetSummary={building.name}
          triggerLabel="咨询该楼盘"
          sourceSection="mobile-bar"
          serviceSchedule={serviceSchedule}
        />
      </div>

      <BackToTop />
      <DetailClickAnalytics />
    </div>
  )
}
