import type { Metadata } from 'next'
import React from 'react'
import BottomCtaBar from '@/components/frontend/landing/BottomCtaBar'
import EntrustForm from '@/components/frontend/landing/EntrustForm'
import LandingHero from '@/components/frontend/landing/LandingHero'
import LandingViewAnalytics from '@/components/frontend/landing/LandingViewAnalytics'
import ProcessSteps from '@/components/frontend/landing/ProcessSteps'
import StatHighlights from '@/components/frontend/landing/StatHighlights'
import {
  BRAND_BADGE,
  ENTRUST_COPY,
  ENTRUST_STATS,
  ENTRUST_STEPS,
} from '@/lib/frontend/landing-config'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

export const metadata: Metadata = buildPageMetadata({
  title: '委托找房｜免费定制选址方案',
  description: '留下手机号，专属顾问 1 对 1 分析选址需求，免费定制上海写字楼、服务式办公与共享办公的选址方案。',
  canonicalPath: '/entrust',
})

const SERVICE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: '委托找房｜定制选址服务',
  serviceType: '写字楼选址顾问服务',
  areaServed: { '@type': 'City', name: '上海' },
  provider: { '@type': 'Organization', name: '商办租赁', url: siteConfig.siteOrigin },
  url: `${siteConfig.siteOrigin}/entrust`,
} as const

export default function EntrustPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }}
      />
      <LandingViewAnalytics pageType="entrust" />
      <LandingHero
        variant="split"
        badge={BRAND_BADGE}
        title={ENTRUST_COPY.title}
        subtitle={ENTRUST_COPY.subtitle}
      >
        <EntrustForm />
      </LandingHero>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">{ENTRUST_COPY.processTitle}</h2>
          <p className="section__subtitle">{ENTRUST_COPY.processSubtitle}</p>
        </div>
        <ProcessSteps steps={ENTRUST_STEPS} size="card" />
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">{ENTRUST_COPY.statsTitle}</h2>
          <p className="section__subtitle">{ENTRUST_COPY.statsSubtitle}</p>
        </div>
        <StatHighlights items={ENTRUST_STATS} />
      </section>

      <BottomCtaBar
        text={ENTRUST_COPY.bottomCtaText}
        ctaLabel={ENTRUST_COPY.bottomCtaLabel}
        targetId="entrust-phone"
        pageType="entrust"
      />
    </>
  )
}
