'use client'

import Link from 'next/link'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import { safeTrackCityEvent, track } from '@/lib/frontend/analytics'

export type ComingSoonCityViewProps = Readonly<{
  city: CityContext
  cities?: readonly PublicCityOption[]
}>

const DEFAULT_DISTRICTS: Record<string, ReadonlyArray<{ name: string; tag: string; sub: string }>> = {
  hangzhou: [
    { name: '钱江新城 CBD', tag: '首批上线', sub: '上城区 · 金融总部核心区' },
    { name: '未来科技城', tag: '首批上线', sub: '余杭区 · 数字经济高地' },
    { name: '滨江物联网小镇', tag: '首批上线', sub: '滨江区 · 科技研发产业聚集' },
    { name: '武林 / 黄龙商圈', tag: '筹备中', sub: '拱墅区/西湖区 · 传统中心 CBD' },
    { name: '奥体博览城 / 世纪城', tag: '筹备中', sub: '萧山区 · 亚运新兴总部区' },
    { name: '城东新城 / 彭埠', tag: '筹备中', sub: '上城区 · 高铁枢纽商务区' },
  ],
}

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

  const customRegions = profile.featuredRegions
  const fallbackDistricts = DEFAULT_DISTRICTS[city.slug] ?? [
    { name: `${city.name}核心商务区`, tag: '首批上线', sub: '核心总部与金融集聚区' },
    { name: `${city.name}高新产业园区`, tag: '首批上线', sub: '科技创新与研发中心' },
    { name: `${city.name}新兴商圈`, tag: '筹备中', sub: '轨道交通与现代服务业枢纽' },
  ]

  return (
    <div className="city-coming-soon">
      {/* 模块 1: Hero 双栏开城落地页 (左文案赋能，右原地表单) */}
      <section className="city-coming-soon__hero city-coming-soon__hero-grid" aria-labelledby="city-launch-heading">
        {/* 背景媒体（若配置） */}
        {profile.hero.media ? <img className="city-coming-soon__media" src={profile.hero.media.src} alt={profile.hero.media.alt} /> : null}

        {/* 左侧：价值传递与合作赋能 */}
        <div className="city-coming-soon__intro">
          <div className="city-coming-soon__eyebrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>{profile.hero.eyebrow || `${city.name}拓展 · 城市先锋招募`}</span>
          </div>

          <h1 id="city-launch-heading" className="city-coming-soon__title">
            {profile.hero.heading || (
              <>商办租赁即将登陆<span>{city.name}</span><br />诚邀本地城市合伙人</>
            )}
          </h1>

          <p className="city-coming-soon__lead">
            {profile.hero.body || `我们正在筹备${city.name}全域的商业办公选址数字化服务。无论您是资深经纪人、本地商办代理机构，还是园区与楼宇运营方，欢迎加入我们，共同开拓${city.name}商办市场。`}
          </p>

          {/* 赋能卡片 */}
          <div className="city-coming-soon__benefits">
            <div className="city-coming-soon__benefit-card">
              <div className="city-coming-soon__benefit-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="city-coming-soon__benefit-content">
                <h3>全国跨城企业客源精准导入</h3>
                <p>承接来自上海及全国总部的外溢选址需求，为{city.name}合伙人持续输送高质量企业租客。</p>
              </div>
            </div>

            <div className="city-coming-soon__benefit-card">
              <div className="city-coming-soon__benefit-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="city-coming-soon__benefit-content">
                <h3>全流程数字化商办 SaaS 赋能</h3>
                <p>提供专业楼盘字典、房源可视化营销工具与线索流转系统，全面提升经纪与房源转化效率。</p>
              </div>
            </div>

            <div className="city-coming-soon__benefit-card">
              <div className="city-coming-soon__benefit-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 12l-4-4-4 4M12 16V8" />
                </svg>
              </div>
              <div className="city-coming-soon__benefit-content">
                <h3>高佣金分成与区域独占支持</h3>
                <p>开放的利润分成机制与核心商圈独家/优先合作席位，切实保障本地合伙人长期收益。</p>
              </div>
            </div>
          </div>

          {/* 租客快速提示入口 */}
          <div className="city-coming-soon__tenant-note">
            <span>🏢 您是急需在{city.name}寻租办公室的企业？</span>
            <InquiryModal
              pageType="home"
              triggerLabel="登记找房需求 ›"
              triggerVariant="ghost"
              onTriggerClick={() => trackCta('inquiry')}
            />
          </div>
        </div>

        {/* 右侧：内嵌城市合伙人申请表单 */}
        <div className="city-coming-soon__form-card">
          <CityPartnerApplicationForm
            cities={selectableCities}
            initialCity={city.slug}
            invalidExplicitCity={false}
            lockCity
            className="city-coming-soon__embedded-form"
          />
        </div>
      </section>

      {/* 模块 2: 重点规划服务商圈 */}
      <section className="city-coming-soon__regions-section" aria-labelledby="city-featured-regions">
        <div className="city-coming-soon__section-header">
          <h2 id="city-featured-regions">{city.name}重点服务商圈布局</h2>
          <p>即将覆盖{city.name}核心商务区与高新产业聚集地</p>
        </div>

        <div className="city-coming-soon__district-grid">
          {customRegions.length > 0
            ? customRegions.map((region) => (
                <div key={region.id} className="city-coming-soon__district-card">
                  <div className="city-coming-soon__district-header">
                    <span className="city-coming-soon__district-name">{region.name}</span>
                    <span className="city-coming-soon__district-status">规划服务区</span>
                  </div>
                  <span className="city-coming-soon__district-sub">{city.name}重点商务板块</span>
                </div>
              ))
            : fallbackDistricts.map((item) => (
                <div key={item.name} className="city-coming-soon__district-card">
                  <div className="city-coming-soon__district-header">
                    <span className="city-coming-soon__district-name">{item.name}</span>
                    <span className="city-coming-soon__district-status">{item.tag}</span>
                  </div>
                  <span className="city-coming-soon__district-sub">{item.sub}</span>
                </div>
              ))}
        </div>
      </section>

      {/* 模块 3: 平台实力背书数据 */}
      <section className="city-coming-soon__stats" aria-label="平台实力背书">
        <div className="city-coming-soon__stat-item">
          <div className="city-coming-soon__stat-number">30,000<span>+</span></div>
          <div className="city-coming-soon__stat-label">已服务成长型及跨城企业</div>
        </div>
        <div className="city-coming-soon__stat-item">
          <div className="city-coming-soon__stat-number">1,500<span>+</span></div>
          <div className="city-coming-soon__stat-label">深度合作标杆甲级写字楼</div>
        </div>
        <div className="city-coming-soon__stat-item">
          <div className="city-coming-soon__stat-number">98.5<span>%</span></div>
          <div className="city-coming-soon__stat-label">客户选址全流程满意度</div>
        </div>
        <div className="city-coming-soon__stat-item">
          <div className="city-coming-soon__stat-number">12<span>城</span></div>
          <div className="city-coming-soon__stat-label">全国直营与合作布局网络</div>
        </div>
      </section>

      {/* 模块 4: 底部双通道转化区 (租客 / 业主分流) */}
      <section className="city-coming-soon__dual-actions" aria-label="客户与业主专项服务">
        <div className="city-coming-soon__action-panel city-coming-soon__action-panel--tenant">
          <div>
            <span className="city-coming-soon__action-badge">企业找房先锋</span>
            <h3>在{city.name}寻找优质办公室？</h3>
            <p>
              虽然{city.name}站仍在筹备阶段，但我们的资深商办顾问已建立本地优质楼盘库。提交选址预算与面积需求，开城第一时间获取专属免佣方案。
            </p>
          </div>
          <div className="city-coming-soon__action-btn-wrap">
            <InquiryModal
              pageType="home"
              triggerLabel={`预约${city.name}专属选址方案`}
              triggerVariant="primary"
              onTriggerClick={() => trackCta('inquiry')}
            />
          </div>
        </div>

        <div className="city-coming-soon__action-panel city-coming-soon__action-panel--landlord">
          <div>
            <span className="city-coming-soon__action-badge">{city.name}业主 / 空间方</span>
            <h3>手里有{city.name}空置房源需要出租？</h3>
            <p>
              商办租赁平台提前开放{city.name}房源入库通道。优先入驻的楼宇、精装办公室与工位将获得首页头条曝光及长三角外溢企业精准推荐。
            </p>
          </div>
          <div className="city-coming-soon__action-btn-wrap">
            <Link
              className="btn btn--secondary"
              href={`/publish?city=${encodeURIComponent(city.slug)}`}
              onClick={() => trackCta('publish')}
            >
              抢先登记合作房源
            </Link>
          </div>
        </div>
      </section>

      {/* 辅助跳转链接 (无障碍与 SEO 完备性) */}
      <section className="city-coming-soon__quick-links" aria-label="其他入口">
        <Link className="btn btn--ghost" href={`/entrust?city=${encodeURIComponent(city.slug)}`} onClick={() => trackCta('entrust')}>委托找房</Link>
        <Link className="btn btn--ghost" href={`/city-partner?city=${encodeURIComponent(city.slug)}`} onClick={() => trackCta('city-partner')}>城市合伙人政策</Link>
        <Link className="visually-hidden" href={basePath}>返回城市首页</Link>
      </section>
    </div>
  )
}
