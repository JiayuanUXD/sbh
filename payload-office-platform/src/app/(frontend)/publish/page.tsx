import type { Metadata } from 'next'
import React from 'react'
import LandingHero from '@/components/frontend/landing/LandingHero'
import LandingViewAnalytics from '@/components/frontend/landing/LandingViewAnalytics'
import SupplySubmissionForm from '@/components/frontend/landing/SupplySubmissionForm'
import { PUBLISH_COPY } from '@/lib/frontend/landing-config'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

export const metadata: Metadata = buildPageMetadata({
  title: '投放房源｜免费委托出租',
  description:
    '业主、物业方与中介可免费提交写字楼房源，平台实勘采集、推广曝光、协助签约成交，可设置佣金悬赏加速出租。',
  canonicalPath: '/publish',
})

const SERVICE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: '房源委托出租服务',
  serviceType: '写字楼房源委托代理',
  areaServed: { '@type': 'City', name: '上海' },
  provider: { '@type': 'Organization', name: '商办租赁', url: siteConfig.siteOrigin },
  url: `${siteConfig.siteOrigin}/publish`,
} as const

/** 全静态房源投放页；数据仅在用户提交时通过公开 API 写入。 */
export default function PublishPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }}
      />
      <LandingViewAnalytics pageType="publish" />
      <LandingHero
        variant="centered"
        backgroundImage={{ src: '/api/media/file/landing-hero-publish-20260810.jpg?prefix=media' }}
        title={PUBLISH_COPY.title}
        subtitle={PUBLISH_COPY.subtitle}
      />
      <SupplySubmissionForm />
    </>
  )
}
