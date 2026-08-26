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
    /**
     * 背景**图**。同时用作背景视频的封面与降级底图。
     *
     * OPT-053 之前它叫「Hero 媒体」且与视频互斥（`HomeHeroMedia` 里
     * `{!poster && loadVideo && <video>}`）——运营配了张图，实际效果是把动态
     * 背景关掉了。图本就是视频的封面，两者不该互斥，现已拆开。
     */
    media: Readonly<{ src: string; width?: number; height?: number; alt: string }> | null
    /** 背景**视频**。null 时用内置默认视频。 */
    video: Readonly<{ src: string }> | null
    /**
     * 是否播放背景视频。
     *
     * 拆开图/视频之后，「只要静态图」成了需要显式表达的意图——
     * 以前它是靠「配了图就没视频」这个副作用实现的。
     */
    videoEnabled: boolean
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
