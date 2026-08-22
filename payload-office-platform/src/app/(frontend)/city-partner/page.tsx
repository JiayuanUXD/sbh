import type { Metadata } from 'next'
import React from 'react'

import {
  listPublicCityOptions,
  resolveCityContext,
  type PublicCityOption,
} from '@/app/(frontend)/_lib/city-context'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import InquiryModal from '@/components/frontend/InquiryModal'
import RecruitHero from '@/components/frontend/city-partner/RecruitHero'
import RecruitSecondaryCta from '@/components/frontend/city-partner/RecruitSecondaryCta'
import RecruitValueProps from '@/components/frontend/city-partner/RecruitValueProps'
import { CITY_PARTNER_COPY } from '@/lib/frontend/city-partner-config'
import { buildPageMetadata, cityPartnerCanonical } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

/**
 * OPT-038 Task 5：`/city-partner` 接线（两个消费面之一 · **中性文案面**）。
 *
 * 与城市路由（`ComingSoonCityView`）共用 RecruitHero / RecruitValueProps /
 * 表单卡 / RecruitSecondaryCta 四个组件，差异全部由 props 承载（工作项 §3.5）。
 *
 * ── 本页为什么不渲染商圈段（RecruitDistrictGrid） ──────────────────────────
 * 三条理由，任意一条都足够：
 *   1. **canonical 恒为 `/city-partner`、不带 query**（metadata 里的
 *      `cityPartnerCanonical()`，且 e2e `multi-city-isolation.spec.ts:118-119`
 *      断言 canonical 的 search 为空）。把随 `?city=` 变化的整段正文挂在一个
 *      固定 canonical 下，等于同一个被索引的 URL 有 N 份不同正文。
 *   2. **本页默认城市是已开通的上海**（`siteConfig.defaultCity`）。商圈段的引导语
 *      是「**即将**覆盖{城市}……」，对一座已开通的城市说这句话是假话。
 *   3. 工作项 §3.5 分派给本页的是「中性文案 + 表单内城市选择器」，
 *      「该城 featuredRegions」分派给的是城市路由。
 * 想让本页也有商圈段，前置条件是先给它一个真正属于本页的城市口径
 * （例如按城市分裂 URL 并各自 canonical），那是信息架构改动，不是接线。
 */

export const metadata: Metadata = buildPageMetadata({
  title: '城市合作伙伴申请',
  description: '提交城市合作伙伴申请，与我们沟通本地商业办公服务资源与合作方向。',
  canonicalPath: cityPartnerCanonical(),
})

export default async function CityPartnerPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ city?: string | string[] }> }>) {
  const [cities, query] = await Promise.all([listPublicCityOptions(), searchParams])
  const explicitCity = typeof query.city === 'string' ? query.city : query.city === undefined ? undefined : ''
  const candidate = explicitCity ?? siteConfig.defaultCity
  const normalized = normalizeCitySlug(candidate)
  const isCanonical = normalized !== null && normalized === candidate
  const context = isCanonical ? await resolveCityContext(candidate) : null
  const selection = context
    ? { selectedCity: context.slug, invalidExplicitCity: false }
    : {
        selectedCity: '',
        invalidExplicitCity: explicitCity !== undefined,
      }
  const selectedOption: PublicCityOption | null = context && !cities.some((city) => city.slug === context.slug)
    ? {
        slug: context.slug,
        name: context.name,
        serviceStatus: context.serviceStatus,
        sortOrder: context.profile.sortOrder,
      }
    : null
  const selectableCities = selectedOption ? [...cities, selectedOption] : cities
  const cityUnavailableMessage = !context && explicitCity === undefined
    ? '当前默认城市暂不可申请，请稍后再试'
    : undefined

  return (
    // 外层不再是 `<main>`：layout.tsx:72 已经给了 `<main id="main-content">`，
    // 旧结构是两层 main 嵌套。换成 `.rc-page` 顺带修掉这个地标嵌套。
    <div className="rc-page">
      {/* h1 文案保持 `CITY_PARTNER_COPY.title`（「城市合作伙伴申请」）——
          这是本任务对 `tests/city-partner-page-seo.test.ts:38` 的处置：
          该断言真正保护的是「页面正文与 metadata.title 口径一致」，
          而 metadata.title（本文件 :16）就是同一个字符串。**让 h1 继续逐字等于它，
          是对这条断言最强的满足**，不是绕过它。城市专属的那句
          「商办租赁即将登陆{城市}……」落在它真正成立的消费面（城市路由）上。
          （断言本身已在测试里加强为「h1 的内容含该字符串」，堵掉把它塞进
          某个 aria-label 蒙混过关的路。） */}
      <RecruitHero
        titleId="city-partner-title"
        eyebrow={CITY_PARTNER_COPY.eyebrow}
        title={CITY_PARTNER_COPY.title}
        subtitle={CITY_PARTNER_COPY.intro}
      />

      {/* 方案 A：价值点主栏 + sticky 表单卡共用同一条灰底带。 */}
      <section className="rc-section rc-section--band" aria-labelledby="city-partner-value-props">
        <div className="rc-container">
          <div className="rc-core">
            <RecruitValueProps titleId="city-partner-value-props" />
            <aside className="rc-aside">
              <CityPartnerApplicationForm
                cities={selectableCities}
                initialCity={selection.selectedCity}
                invalidExplicitCity={selection.invalidExplicitCity}
                cityUnavailableMessage={cityUnavailableMessage}
              />
              {/* 合规声明：稿子没有它的位置，但它是既有合规文案，不能因改版消失
                  （`city-partner-page-seo.test.ts:39` 的四个禁词正是它在否认的东西）。
                  放表单卡正下方——它说的是「提交这张表意味着什么」。 */}
              <p className="rc-aside__note">{CITY_PARTNER_COPY.note}</p>
            </aside>
          </div>
        </div>
      </section>

      {/* 次要入口：稿子只画了租客这一张卡，本页也只给一张。
          业主入口（/publish）是城市路由的既有功能，本页此前没有，不在这里凭空新增。 */}
      <RecruitSecondaryCta
        label="企业找房入口"
        entries={[{
          title: '您是需要寻租办公室的企业？',
          body: '留下面积与预算，顾问会与您联系并给出选址建议。',
          action: (
            // pageType='content'（`SOURCE_PAGE_TYPES` 的合法值之一）而不是
            // ComingSoonCityView 沿用的 'home'：本页不是首页，把线索归到 'home'
            // 会污染入口归因。城市路由那两处保持 'home' 不动——那是既有取值，
            // 改它会改动已有线索的归因口径，属另一件事。
            <InquiryModal
              pageType="content"
              triggerLabel="登记找房需求"
              triggerVariant="ghost"
              triggerClassName="rc-secondary-btn"
            />
          ),
        }]}
      />
    </div>
  )
}
