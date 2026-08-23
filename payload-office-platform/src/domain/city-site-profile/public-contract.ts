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
  /**
   * 精选区域（运营在 `CitySiteProfiles.featuredRegions` 选定的行政区 / 商圈）。
   *
   * `parentName` / `description` 是 OPT-038 Task 4 补上的映射：两个字段在
   * `Locations` 上一直存在（`parent` 上级区域、`description` 区域介绍），
   * 只是从没被 `mapFeaturedRegions` 读出来 —— 属「层② 缺映射」，补映射而非绕开。
   */
  featuredRegions: readonly Readonly<{
    id: number | string
    slug: string
    name: string
    type: 'district' | 'business_area'
    /**
     * 上级行政区名（商圈 → 其所属行政区）。
     * **上级就是本 profile 的城市时为 `null`**：行政区的 `parent` 恒为城市，
     * 在城市自己的页面上再写一遍城市名是噪音，不是区位信息。
     * 未填上级、或取数 depth 不足以展开上级时同样为 `null`（后者会打 error 日志）。
     */
    parentName: string | null
    /** `Locations.description`「区域介绍」。未填 / 空白为 `null`（不是空串）。 */
    description: string | null
  }>[]
}>
