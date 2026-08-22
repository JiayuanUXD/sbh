import type { CityServiceStatus } from './schema'

export type PublicCitySiteProfile = Readonly<{
  cityId: number | string
  citySlug: string
  cityName: string
  serviceStatus: CityServiceStatus
  switcherVisible: boolean
  sortOrder: number
  /** 数据带「平均响应 N 小时」，运营承诺口径；null = 首页不展示该格 */
  avgResponseHours: number | null
  seoTitle: string
  seoDescription: string
  hero: Readonly<{
    eyebrow: string
    heading: string
    body: string
    media: Readonly<{ src: string; width?: number; height?: number; alt: string }> | null
  }>
  intro: Readonly<{ heading: string; body: string }>
  contact: Readonly<{ heading: string; body: string }>
  featuredRegions: readonly Readonly<{
    id: number | string
    slug: string
    name: string
    type: 'district' | 'business_area'
  }>[]
}>
