'use client'

import Link from 'next/link'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import RecruitDistrictGrid from '@/components/frontend/city-partner/RecruitDistrictGrid'
import RecruitHero from '@/components/frontend/city-partner/RecruitHero'
import RecruitSecondaryCta from '@/components/frontend/city-partner/RecruitSecondaryCta'
import RecruitValueProps from '@/components/frontend/city-partner/RecruitValueProps'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import { CITY_PARTNER_COPY } from '@/lib/frontend/city-partner-config'
import { safeTrackCityEvent, track } from '@/lib/frontend/analytics'

/**
 * OPT-038 Task 5：城市路由接线（两个消费面之一 · **城市专属文案面**）。
 *
 * 挂在 4 条路由上：`/[city]`、`/[city]/listings`、`/[city]/buildings`、`/[city]/sale`
 * （`serviceStatus === 'coming-soon'` 时渲染）。与 `/city-partner` 共用
 * RecruitHero / RecruitValueProps / 表单卡 / RecruitSecondaryCta，
 * 差异由 props 承载（工作项 §3.5）：这边给城市专属语气 + 该城 `featuredRegions`。
 *
 * ── 根节点为什么是 `.city-coming-soon > .rc-page` 两层 ─────────────────────
 * `tests/coming-soon-city-view.test.ts:37` 对源码做文本断言，要求逐字出现
 * `<div className="city-coming-soon">`——根类名不能改、也不能追加第二个类名。
 * 于是 `.rc-page` 作为内层壳，Task 3 那整节 `.rc-page .city-partner-form*`
 * 的作用域在两个消费面上就是同一个选择器。外壳的旧盒模型在 recruit.css 里被复位。
 *
 * ── 本次去掉了什么，为什么 ────────────────────────────────────────────────
 *   - **3 张赋能卡**（旧 :87-129）→ `RecruitValueProps`。三条标题逐字相同，
 *     正文换成 `RECRUIT_VALUE_POINTS` 的短句版（两个消费面共用一份文案，
 *     不再各写一遍）。城市名插值随之消失——那是刻意的：同一段市场承诺
 *     不应该有两个事实源（RecruitValueProps.tsx 的常量注释写了这条）。
 *   - **硬编码的 `DEFAULT_DISTRICTS`**（旧 :16-25 / :54-58）与写死的
 *     「规划服务区」标签（旧 :168）→ 整个删除，改由 `RecruitDistrictGrid`
 *     消费真实的 `profile.featuredRegions`。这份兜底数据里的
 *     「首批上线 / 筹备中」是**按列表位置编出来的批次**，域层根本没有这个维度
 *     （判定过程见 RecruitDistrictGrid.tsx 文件头、工作项 §3.3）；
 *     Task 4 刚把这个承诺从新组件里去掉，留着旧的一套会让两套商圈渲染并存，
 *     而旧的那套编的正好是新的那套刚删掉的东西。
 *     **后果要正视**：`featuredRegions` 为空的城市（本地库 7 个 profile 全空）
 *     现在**整段不渲染**，而不是掉回一份编造的清单。空货架 < 假货架。
 *   - **「平台实力背书数据」带**（旧 :186-203）→ 删除。四个数字
 *     30,000+ / 1,500+ / 98.5% / 12 城全是**写死的字面量**，没有任何数据源；
 *     其中「12 城」与平台实际的 7 座城市 profile 直接矛盾。本批的硬约束是
 *     「数字一律有源、缺失显示 —、不显示 0」，一条写死的战绩数字迟早变成假话
 *     （与 Task 2 去掉「第 8 城」同型）。要恢复，前置条件是这些数字有真实口径与取数。
 *   - **双通道转化区**（旧 :206-243）→ 两条入口都保留，改由
 *     `RecruitSecondaryCta` 按稿子的次要入口版式渲染（租客 / 业主各一张卡），
 *     `trackCta('inquiry')` / `trackCta('publish')` 原样挂着。
 *   - **辅助跳转链接**（旧 :246-250）→ 保留，改成 `.rc-quick-links` 文字链接行。
 *     `/entrust?city=` 与 `/city-partner?city=` 两条 href 与埋点一字未动。
 *
 * ── 没有新增任何 live region ──────────────────────────────────────────────
 * `role="status"` 在本页仍然只有表单那一个（`InquiryModal` 自带的那个在弹层里，
 * 只有 open 时才 createPortal 渲染）。
 */

export type ComingSoonCityViewProps = Readonly<{
  city: CityContext
  cities?: readonly PublicCityOption[]
}>

export default function ComingSoonCityView({ city, cities }: ComingSoonCityViewProps) {
  const basePath = `/${city.slug}`
  const profile = city.profile
  const selectableCities: readonly PublicCityOption[] = cities && cities.length > 0
    ? cities
    : [{
        slug: city.slug,
        name: city.name,
        serviceStatus: city.serviceStatus,
        sortOrder: profile.sortOrder,
      }]

  const trackCta = (ctaType: 'entrust' | 'publish' | 'inquiry' | 'city-partner') => {
    safeTrackCityEvent(track, 'coming_soon_cta_clicked', {
      city: city.slug,
      status: city.serviceStatus,
      cta_type: ctaType,
    })
    if (ctaType === 'city-partner') {
      safeTrackCityEvent(track, 'city_partner_cta_clicked', {
        city: city.slug,
        status: city.serviceStatus,
      })
    }
  }

  return (
    <div className="city-coming-soon">
      <div className="rc-page">
        {/* Hero。三个 `profile.hero.*` 覆写的**触发条件一字未变**：非空就用运营填的，
            空就用兜底。变的只有兜底文案本身（对齐稿子），以及标题不再手写 `<br>`
            与包住城市名的 `<span>`——断行改由 `text-wrap: balance` 自适应，
            城市名长度不同也不会崩（RecruitHero 的注释里有 1440 下的行盒实测）。
            背景媒体走 backdrop 插槽，`profile.hero.media` 的渲染条件同样未变。 */}
        <RecruitHero
          titleId="city-launch-heading"
          eyebrow={profile.hero.eyebrow || undefined}
          title={profile.hero.heading || `商办租赁即将登陆${city.name}，诚邀本地城市合伙人`}
          subtitle={profile.hero.body || '面向资深经纪人、本地商办代理机构、园区与楼宇运营方开放合作席位。'}
          backdrop={profile.hero.media ? <img className="city-coming-soon__media" src={profile.hero.media.src} alt={profile.hero.media.alt} /> : null}
        />

        {/* 方案 A：价值点主栏 + sticky 表单卡共用同一条灰底带。
            表单的 4 个 prop（cities / initialCity / invalidExplicitCity / lockCity）
            与那个 `city-coming-soon__embedded-form` 的 className 一字未改——
            城市锁定、单选项兜底、提交链路全部保持原触发条件。 */}
        <section className="rc-section rc-section--band" aria-labelledby="city-launch-value-props">
          <div className="rc-container">
            <div className="rc-core">
              <RecruitValueProps titleId="city-launch-value-props" />
              <aside className="rc-aside">
                <CityPartnerApplicationForm
                  cities={selectableCities}
                  initialCity={city.slug}
                  invalidExplicitCity={false}
                  lockCity
                  className="city-coming-soon__embedded-form"
                />
                {/* 合规声明。改版前只有 `/city-partner` 显示它，城市路由没有；
                    而城市路由旧版恰恰是承诺最多的一版（「切实保障本地合伙人长期收益」
                    「核心商圈独家/优先合作席位」）。两个消费面共用同一张申请表，
                    「提交申请不代表合作确认」在两边同样成立，补上是收紧不是放松。 */}
                <p className="rc-aside__note">{CITY_PARTNER_COPY.note}</p>
              </aside>
            </div>
          </div>
        </section>

        {/* 商圈布局：真实 `featuredRegions`，空数组则整段不渲染（组件内判定）。
            heading 的 id 沿用旧的 `city-featured-regions`。 */}
        <RecruitDistrictGrid
          titleId="city-featured-regions"
          cityName={city.name}
          districts={profile.featuredRegions}
        />

        {/* 次要入口：租客 / 业主两条既有转化通道，版式换成稿子的尾注卡。 */}
        <RecruitSecondaryCta
          label="客户与业主专项服务"
          entries={[
            {
              title: `您是需要在${city.name}寻租办公室的企业？`,
              body: `留下面积与预算，${city.name}开通后第一批推送匹配房源。`,
              action: (
                <InquiryModal
                  pageType="home"
                  triggerLabel="登记找房需求"
                  triggerVariant="ghost"
                  triggerClassName="rc-secondary-btn"
                  onTriggerClick={() => trackCta('inquiry')}
                />
              ),
            },
            {
              title: `手里有${city.name}空置房源需要出租？`,
              body: `${city.name}房源入库通道已提前开放，先入驻的楼宇与办公室在开城时优先获得曝光。`,
              action: (
                <Link
                  className="btn btn--ghost rc-secondary-btn"
                  href={`/publish?city=${encodeURIComponent(city.slug)}`}
                  onClick={() => trackCta('publish')}
                >
                  抢先登记合作房源
                </Link>
              ),
            },
          ]}
          footer={(
            <div className="rc-quick-links">
              <Link href={`/entrust?city=${encodeURIComponent(city.slug)}`} onClick={() => trackCta('entrust')}>委托找房</Link>
              <Link href={`/city-partner?city=${encodeURIComponent(city.slug)}`} onClick={() => trackCta('city-partner')}>城市合伙人政策</Link>
              <Link className="visually-hidden" href={basePath}>返回城市首页</Link>
            </div>
          )}
        />
      </div>
    </div>
  )
}
