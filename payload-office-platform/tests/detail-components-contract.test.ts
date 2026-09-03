import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailGallery from '@/components/frontend/DetailGallery'
import ListingCard from '@/components/frontend/ListingCard'
import AnchorNavBar from '@/components/frontend/detail/AnchorNavBar'
import StickyInquiryBar from '@/components/frontend/detail/StickyInquiryBar'
import * as BuildingSupplyBrowserModule from '@/components/frontend/BuildingSupplyBrowser'
import type {
  BuildingSupplySnapshot,
  DetailMediaViewModel,
  ListingCardViewModel,
} from '@/domain/public-catalog'

const BuildingSupplyBrowser = BuildingSupplyBrowserModule.default

// `DetailFacts.tsx` 随组件删除一并移出本清单（OPT-037 终审第 2 轮 D1：
// 生产零引用，最后的引用者就是本测试自己）。
const DETAIL_COMPONENT_FILES = [
  'DetailGallery.tsx',
  'BuildingSupplyBrowser.tsx',
  'InquiryModal.tsx',
  'detail/AnchorNavBar.tsx',
  'detail/ListingDecisionCard.tsx',
  'detail/ListingOverviewPanel.tsx',
] as const

function makeCard(overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  return {
    id: 1,
    slug: 'jingan-center-101',
    title: '静安中心 101 室',
    price: null,
    area: 101,
    floor: null,
    seats: null,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: 'listing-1',
    ...overrides,
    citySlug: overrides.citySlug ?? 'shanghai',
    cityName: overrides.cityName ?? '上海市',
  }
}

const LEASE_ONLY_SNAPSHOT: BuildingSupplySnapshot = {
  asOf: '2026-07-30T10:00:00.000Z',
  totalEffectiveListings: 1,
  resultCount: 1,
  validationErrors: [],
  groups: [
    {
      key: 'lease',
      listings: [makeCard()],
      priceRanges: [],
      areaRange: { min: 101, max: 101 },
      seatRange: null,
      immediateAvailabilityCount: 1,
      priceSortDegraded: false,
    },
  ],
  availableGroups: [{
    key: 'lease',
    totalEffectiveListings: 1,
    priceRanges: [],
    areaRange: { min: 101, max: 101 },
    seatRange: null,
    immediateAvailabilityCount: 1,
  }],
}

describe('detail component contracts', () => {
  it('所有前台详情组件不导入 payload-types 或 payload', () => {
    for (const file of DETAIL_COMPONENT_FILES) {
      const source = readFileSync(
        join(process.cwd(), 'src/components/frontend', file),
        'utf8',
      )
      expect(source).not.toMatch(/from ['"]payload['"]|from ['"]@\/payload-types['"]/)
      expect(source).not.toMatch(/payload-types/)
    }
  })

  /**
   * `'use client'` 组件的**值**导入不得走 `@/domain/public-catalog` 桶文件。
   *
   * 桶文件 `export * from './facade'`，facade 又 import `supply-adapter.ts`
   * （里面 `import { getPayload } from 'payload'`）——于是一个看起来只是
   * 「从 domain 拿个纯函数」的 import 会把 Payload 整个拖进客户端 bundle，
   * Next 在 dev 直接编译报错。`import type` 不受影响（编译期擦除）。
   * 上面那条「不导入 payload」的守卫抓不到它：源码里根本没有 'payload' 字样，
   * 失效点在**传递依赖**上，所以守卫必须钉在「桶文件值导入」这个形态上。
   */
  it('客户端详情组件的值导入不走 domain 桶文件（只允许 import type）', () => {
    for (const file of DETAIL_COMPONENT_FILES) {
      const source = readFileSync(join(process.cwd(), 'src/components/frontend', file), 'utf8')
      if (!/^['"]use client['"]/m.test(source)) continue
      // (?!\bimport\b) 防止懒惰匹配跨过前一条 import 语句去够到桶文件路径
      const barrelImports =
        source.match(/^import\s+(?!type\b)(?:(?!\bimport\b)[\s\S])*?from ['"]@\/domain\/public-catalog['"]/gm) ?? []
      expect(barrelImports).toEqual([])
    }
  })

  it('画廊为有效媒体使用原生媒体语义，并为无效媒体提供确定性回退', () => {
    const imageMedia: DetailMediaViewModel[] = [
      {
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      },
    ]
    const videoMedia: DetailMediaViewModel[] = [
      {
        id: 'video-1',
        kind: 'video',
        category: 'tour',
        resource: { src: '/tour.mp4', alt: '办公室视频' },
        capturedAt: null,
        isSchematic: false,
      },
    ]

    // 图片分类默认渲染，使用原生 figure/img
    const imageHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: imageMedia, title: '静安中心' }),
    )
    // 视频分类单独渲染时默认即视频 Tab，使用原生 video controls（P1: 视频延迟挂载
    // 不进首屏，但单一视频分类下视频 Tab 即默认 Tab，SSR 仍输出原生 video 语义）
    const videoHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: videoMedia, title: '静安中心' }),
    )
    const fallback = renderToStaticMarkup(
      createElement(DetailGallery, { media: [], title: '静安中心' }),
    )

    expect(imageHtml).toContain('<figure')
    expect(imageHtml).toContain('<img')
    expect(videoHtml).toContain('<video')
    expect(videoHtml).toContain('controls=""')
    expect(fallback).toContain('图片拍摄中')
    expect(fallback).toContain('role="img"')
  })

  /**
   * 无图替代构图（Task 2 建、Task 10b 参数化）——本项目对这一段的硬约束是
   * 「不得渲染空占位」：调用方给了替代内容就必须换构图，而不是灰底占位；
   * 缺值渲染 — 而不是 0，也不是把那一格藏掉。
   */
  it('提供 noMediaFallback 时用替代构图接管，不渲染灰底占位', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      media: [],
      title: '静安中心',
      pageType: 'building',
      noMediaFallback: {
        keySpecs: [
          { label: '标准层面积', value: '1500', unit: '㎡' },
          { label: '停车位', value: null },
        ],
        meta: [{ label: '楼盘简介', value: null }],
      },
    }))

    expect(html).toContain('dt-nomedia')
    expect(html).toContain('data-media-state="missing"')
    // 灰底占位的两个标志物都必须消失，否则就是"两块都渲染了"
    expect(html).not.toContain('media-placeholder')
    expect(html).not.toContain('图片拍摄中')
    expect(html).toContain('1500')
    expect(html).toContain('㎡')
    // 缺值 —，不是 0、不是空白，也不是整格消失
    expect(html).toContain('停车位')
    expect((html.match(/—/g) ?? []).length).toBe(2)
    expect(html).not.toMatch(/dt-keyspecs__value">0</)
  })

  it('noMediaFallback.meta 为空数组时底条整条不渲染（不留只有标签的空条）', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      media: [],
      title: '静安中心',
      noMediaFallback: { keySpecs: [{ label: '停车位', value: '120', unit: '个' }], meta: [] },
    }))

    expect(html).toContain('dt-keyspecs')
    expect(html).not.toContain('dt-nomedia__meta')
  })

  it('画廊防御性拒绝 mapper 之外流入的不安全媒体 URL', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      media: [{
        id: 'unsafe',
        kind: 'image',
        category: 'interior',
        resource: { src: 'javascript:alert(1)', alt: '不应渲染' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('图片拍摄中')
    expect(html).not.toContain('javascript:alert')
  })

  it('画廊媒体交互只暴露匿名类别、序号和页面类型', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      pageType: 'listing',
      media: [{
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('data-detail-analytics-event="media_view"')
    expect(html).toContain('data-analytics-page-type="listing"')
    expect(html).toContain('data-analytics-media-category="interior"')
    expect(html).not.toContain('data-analytics-title')
  })

  it('详情画廊为全屏预览提供语义化触发按钮与可访问名称', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      media: [{
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('<button')
    expect(html).toContain('查看全屏媒体')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  /*
   * 原「事实组件将关键缺失值标为咨询确认，并忽略普通缺失值」用例随
   * `DetailFacts` 组件删除（终审第 2 轮 D1：生产零引用）。
   * **被守护的行为没有丢**：`critical → 「咨询确认」/ 普通缺失 → 省略` 的判定
   * 本来就在 `lib/frontend/format.ts` 的 `formatFact()` 里，由
   * `tests/format.test.ts` 直接覆盖；`estimated → 「（估算）」` 的展示由
   * `tests/building-spec-panel.test.ts` / `tests/listing-overview-panel.test.ts`
   * 在现役组件上覆盖。这里删掉的只是「已下线组件的渲染快照」。
   */

  it('桌面服务端默认输出单一密度表，按 URL 而非 GET 表单驱动组切换/筛选/排序', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: LEASE_ONLY_SNAPSHOT,
        basePath: '/buildings/jingan-center',
        currentSearch: '',
      }),
    )

    expect(html).toContain('<table')
    expect(html).toContain('租赁房源列表')
    expect(html).toContain('面积')
    expect(html).toContain('排序')
    // 单一业务组时仍渲染组 tab（只有一个），但不使用 GET 表单/tab 部件语义
    expect(html).toContain('aria-current="true"')
    expect(html).not.toContain('method="get"')
    expect(html).not.toContain('type="submit"')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('卡片视图')
    expect(html).not.toContain('表格视图')
    expect(html).not.toContain('供给展示方式')
  })

  it('组切换 href 只在非默认组时写入 group 参数，默认组省略', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      groups: [
        LEASE_ONLY_SNAPSHOT.groups[0]!,
        { key: 'sale', listings: [makeCard({ id: 2, businessType: 'sale' })], priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1, priceSortDegraded: false },
      ],
      availableGroups: [
        LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        { key: 'sale', totalEffectiveListings: 1, priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot, basePath: '/buildings/jingan-center', currentSearch: '' }),
    )

    // 默认组（数组第一个，lease）不带 group 参数；非默认组（sale）带
    expect(html).toContain('href="/buildings/jingan-center"')
    expect(html).toContain('href="/buildings/jingan-center?group=sale"')
  })

  it('组切换后读取 URL 上的 group 参数展示对应组，而非始终展示第一个', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      groups: [
        LEASE_ONLY_SNAPSHOT.groups[0]!,
        { key: 'sale', listings: [makeCard({ id: 2, title: '出售样例房源', businessType: 'sale' })], priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1, priceSortDegraded: false },
      ],
      availableGroups: [
        LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        { key: 'sale', totalEffectiveListings: 1, priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot, basePath: '/buildings/jingan-center', currentSearch: 'group=sale' }),
    )

    expect(html).toContain('出售样例房源')
    expect(html).toContain('总价 万元')
    expect(html).not.toContain('静安中心 101 室')
  })

  /**
   * 终审 C1：出售组不得渲染「可即时过户 N」聚合格，也不得渲染「可即刻入驻」pill。
   *
   * `immediateAvailabilityCount` 数的是 `isImmediatelyAvailable`，它对
   * `availableFrom == null` 一律判真（「未填 = 现房」的租赁口径），而
   * `collections/Listings.ts` 的 `availableFrom` admin condition 是
   * `businessType !== 'sale'`——出售房源该字段**结构上恒为 null**。两者相乘的结果
   * 是「可即时过户 N」恒等于该组全部套数：对每一套在售房源做了一次它没有依据的
   * 产权承诺。同一根因还会渲染出一个租赁文案的「可即刻入驻」pill，点它结果集一条
   * 不变、计数一条不减，`aria-current` 却亮起——正是本批自己禁的「点了没反应的
   * 控件」。守卫落在渲染结果上，任何「把 immediate 格补回出售组」的改动会先撞到它。
   */
  it('出售组不渲染「可即时过户」聚合格与「可即刻入驻」pill（域层没有过户依据）', () => {
    const saleSnapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      // asOf 之后才可入驻的租赁卡不影响本例；关键是出售组的 immediateAvailabilityCount
      // 恒等于套数（域层就是这么算的），组件必须自己不去渲染它。
      groups: [
        { key: 'sale', listings: [makeCard({ id: 2, businessType: 'sale' })], priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1, priceSortDegraded: false },
      ],
      availableGroups: [
        { key: 'sale', totalEffectiveListings: 1, priceRanges: [], areaRange: null, seatRange: null, immediateAvailabilityCount: 1 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot: saleSnapshot, basePath: '/buildings/jingan-center', currentSearch: '' }),
    )

    expect(html).not.toContain('可即时过户')
    // 「可即刻入驻」是租赁文案，出售组连 pill 都不该有
    expect(html).not.toContain('可即刻入驻')
    // 聚合区其余两格照常渲染（不是整块消失）
    expect(html).toContain('单价区间')
    expect(html).toContain('面积区间')
  })

  it('租赁组仍渲染「可即刻入驻」聚合格与 pill（本条不是把这一维整体删掉）', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot: LEASE_ONLY_SNAPSHOT, basePath: '/buildings/jingan-center', currentSearch: '' }),
    )
    expect(html).toContain('可即刻入驻')
  })

  /**
   * 终审 C2：「该组内房源计价单位不唯一」这句提示必须读**当前组**的
   * `priceSortDegraded`，不能读快照级 `validationErrors`（后者是「任一组降级」的
   * 汇总信号）。否则「本组单位唯一、只是这栋楼另有一个出售组」时会说出假话。
   */
  it('当前组未降级时不渲染「计价单位不唯一」提示，哪怕快照级 validationErrors 已置位', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: {
          ...LEASE_ONLY_SNAPSHOT,
          // 另一组降级 → 快照级信号置位；当前组（lease）没降级
          validationErrors: ['price_unit_required'],
        },
        basePath: '/buildings/jingan-center',
        currentSearch: 'sort=price-asc',
      }),
    )
    expect(html).not.toContain('计价单位不唯一')
  })

  it('当前组确实降级时才渲染「计价单位不唯一」提示', () => {
    const degraded: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      groups: [{ ...LEASE_ONLY_SNAPSHOT.groups[0]!, priceSortDegraded: true }],
      validationErrors: ['price_unit_required'],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: degraded,
        basePath: '/buildings/jingan-center',
        currentSearch: 'sort=price-asc',
      }),
    )
    expect(html).toContain('计价单位不唯一')
  })

  it('空组（priceRanges 空）仍渲染表格，「—」代表价格缺失而非分桶控件', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: {
          ...LEASE_ONLY_SNAPSHOT,
          groups: [{
            key: 'lease',
            listings: [
              makeCard({ id: 1, price: null }),
            ],
            priceRanges: [],
            areaRange: null,
            seatRange: null,
            immediateAvailabilityCount: 0,
            priceSortDegraded: false,
          }],
        },
        basePath: '/buildings/jingan-center',
        currentSearch: '',
      }),
    )

    expect(html).toContain('<table')
    // 价格缺失渲染为 —，不渲染成 0 或伪造分桶控件
    expect(html).not.toContain('8 元以下')
    expect(html).not.toContain('9–10 元')
  })

  /**
   * 「筛到空结果」不得变成死路：改造前筛选行常驻，一旦跟着结果集消失，用户没有
   * 任何入口取消刚点下的筛选。聚合区同样保留（它取未过滤口径，描述的是这个组的
   * 画像，不是当前结果集）。
   */
  it('筛到空结果时聚合区与筛选/排序控件仍渲染，只有结果行换成空态提示', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        // groups 为空 = 当前 query 下该组没有任何命中行（domain 的真实产出形态）
        snapshot: { ...LEASE_ONLY_SNAPSHOT, groups: [], resultCount: 0 },
        basePath: '/buildings/jingan-center',
        currentSearch: 'areaMin=1000',
      }),
    )

    expect(html).toContain('当前筛选下暂无匹配空间')
    expect(html).toContain('按面积筛选')
    expect(html).toContain('排序')
    // 取消当前筛选的入口必须还在（回到「全部」的那条 href）
    expect(html).toContain('href="/buildings/jingan-center"')
    // 聚合区取未过滤口径，因此仍有内容
    expect(html).toContain('面积区间')
    expect(html).not.toContain('<table')
  })

  /**
   * 「可即刻入驻」pill 的激活判据是「availableBefore 存在」，不是「它恰好等于
   * 今天」——否则分享链接过一天再打开，pill 显示未激活、过滤却仍生效，且点它
   * 只会换成新日期、永远取消不掉。
   */
  it('可即刻入驻 pill 在任意 availableBefore 值下都是激活态，点击即清除该参数', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: LEASE_ONLY_SNAPSHOT,
        basePath: '/buildings/jingan-center',
        // 与 snapshot.asOf（2026-07-30）不同的一天：跨天分享链接的形态
        currentSearch: 'availableBefore=2026-07-01',
      }),
    )

    expect(html).toMatch(/可即刻入驻/)
    // 激活态用 aria-current（真实导航链接，不许挂 role="button" + aria-pressed）
    expect(html).not.toContain('aria-pressed')
    const pill = /<a[^>]*aria-current="true"[^>]*>可即刻入驻<\/a>/.exec(html)
      ?? /<a[^>]*>可即刻入驻<\/a>/.exec(html)
    expect(pill?.[0]).toContain('aria-current="true"')
    // 取消 = delete，不是换成新日期
    expect(pill?.[0]).toContain('href="/buildings/jingan-center"')
  })

  /**
   * 价格分桶迁移到 URL 后仍受单位闸门约束：href 必须把 priceUnit 与区间一起写入，
   * 否则域层会（正确地）忽略这个区间，控件就变成点了没反应。
   */
  it('价格桶 href 同时写入 priceUnit 与区间，「全部」把三个键一起清除', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      availableGroups: [{
        ...LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        priceRanges: [{
          key: 'lease:CNY:day:sqm:rmb-sqm-day',
          businessType: 'lease',
          currency: 'CNY',
          period: 'day',
          basis: 'sqm',
          displayUnit: 'rmb-sqm-day',
          min: 7.5,
          max: 11,
          count: 3,
        }],
      }],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot,
        basePath: '/buildings/jingan-center',
        currentSearch: 'priceUnit=rmb-sqm-day&priceMin=8&priceMax=9',
      }),
    )

    expect(html).toContain('按价格筛选')
    expect(html).toContain('priceUnit=rmb-sqm-day')
    expect(html).toContain('priceMin=10')
    // 「8–9 元」是当前桶
    expect(/<a[^>]*aria-current="true"[^>]*>8–9 元<\/a>/.test(html)).toBe(true)
    // 「全部」回到无 price* 参数的裸路径
    expect(/<a[^>]*href="\/buildings\/jingan-center"[^>]*>全部<\/a>/.test(html)).toBe(true)
  })

  it('组内没有元/㎡/天 房源时整组价格桶不渲染（边界只对该单位有意义）', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      availableGroups: [{
        ...LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        priceRanges: [{
          key: 'lease:CNY:month:total:rmb-month',
          businessType: 'lease',
          currency: 'CNY',
          period: 'month',
          basis: 'total',
          displayUnit: 'rmb-month',
          min: 25_000,
          max: 70_000,
          count: 2,
        }],
      }],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot,
        basePath: '/buildings/jingan-center',
        currentSearch: '',
      }),
    )

    expect(html).not.toContain('按价格筛选')
    expect(html).toContain('按面积筛选')
  })

  it('推荐房源卡只写入匿名点击上下文', () => {
    const html = renderToStaticMarkup(createElement(ListingCard, {
      listing: makeCard({ id: 102, title: '静安中心 102 室' }),
      detailAnalytics: {
        event: 'recommendation_click',
        parentId: 101,
        rank: 1,
        section: 'related',
        recommendationType: 'same_building',
      },
    }))

    expect(html).toContain('data-detail-analytics-event="recommendation_click"')
    expect(html).toContain('data-analytics-parent-id="101"')
    expect(html).toContain('data-analytics-rank="1"')
    expect(html).not.toContain('data-analytics-title')
  })

  /* ── 吸附锚点导航（Task 8） ──────────────────────────────────────────────
   * 钉住三件在接线时最容易被推翻的事：
   *   1. 锚点项完全来自 `items`，组件内部没有「默认 4 项」的兜底——硬编码会
   *      在空态整段不渲染的页面上产出死锚点；
   *   2. `items.length <= 1` 时锚点组不渲染，但吸附条本体与 CTA 仍在；
   *   3. 锚点是真实的 `<a href="#id">`，不带 role="button"（用 aria-current
   *      表达当前态，不是 aria-pressed）。
   * 用 SSR 静态标记断言：这三条都是首帧就必须成立的结构性事实，与
   * IntersectionObserver / 滚动无关。 */
  it('锚点导航只渲染调用方装配的项，且是原生 #id 链接', () => {
    const html = renderToStaticMarkup(
      createElement(AnchorNavBar, {
        title: '静安嘉里中心',
        items: [
          { id: 'sec-supply', label: '在租房源' },
          { id: 'sec-spec', label: '楼盘参数' },
        ],
      }),
    )

    expect(html).toContain('href="#sec-supply"')
    expect(html).toContain('href="#sec-spec"')
    // 稿子里的另外两项没有被装配 → 组件不得自己补出来
    expect(html).not.toContain('周边与交通')
    expect(html).not.toContain('同商圈楼盘')
    // 真实导航链接：不许把 <a> 谎报成按钮，当前态用 aria-current 而非 aria-pressed
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('aria-pressed')
    // 首帧（页面在顶部）默认高亮第一项，不留「全部不高亮」的空窗
    expect(html).toMatch(/href="#sec-supply"[^>]*aria-current="true"/)
    expect(html).not.toMatch(/href="#sec-spec"[^>]*aria-current/)
  })

  it('锚点导航在只剩 1 项时不渲染锚点组，但保留吸附条与 CTA', () => {
    const html = renderToStaticMarkup(
      createElement(AnchorNavBar, {
        title: '虹桥天地',
        items: [{ id: 'sec-spec', label: '楼盘参数' }],
        cta: createElement('button', { type: 'button' }, '预约看房'),
      }),
    )

    expect(html).toContain('dt-anchor-bar')
    expect(html).toContain('虹桥天地')
    expect(html).toContain('预约看房')
    expect(html).not.toContain('href="#sec-spec"')
    expect(html).not.toContain('dt-anchor-bar__links')
    // ≤767 断点下楼盘名与 CTA 都被 CSS 藏起来，没有锚点组 = 整条不含任何内容。
    // 组件必须把「没渲染锚点组」这个只有它知道的事实标出来，CSS 才能在那个
    // 断点上把整条收掉（否则就是一条纯空白、常驻吸附并遮住内容的 56px 条）。
    expect(html).toContain('dt-anchor-bar--no-links')
  })

  it('锚点导航渲染了锚点组时不带 --no-links 标记', () => {
    const html = renderToStaticMarkup(
      createElement(AnchorNavBar, {
        title: '静安嘉里中心',
        items: [
          { id: 'sec-supply', label: '在租房源' },
          { id: 'sec-spec', label: '楼盘参数' },
        ],
      }),
    )

    expect(html).toContain('dt-anchor-bar__links')
    expect(html).not.toContain('dt-anchor-bar--no-links')
  })

  it('detail.css 在 ≤767 断点把无锚点组的吸附条整条收掉', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/app/(frontend)/styles/detail.css'),
      'utf8',
    )
    // detail.css 里有多个 ≤767 断点块（页面骨架、锚点导航……），只取第一个会在
    // 新增块插到前面时静默失配——把所有块拼起来断言。
    const mobileBlocks = (css.match(/@media \(max-width: 767px\) \{[\s\S]*?\n\}/g) ?? []).join('\n')
    expect(mobileBlocks).toMatch(/\.dt-anchor-bar--no-links\s*\{\s*display:\s*none/)
  })

  it('锚点导航在既无锚点项也无 CTA 时整条不渲染', () => {
    const html = renderToStaticMarkup(
      createElement(AnchorNavBar, { title: '静安嘉里中心', items: [] }),
    )

    expect(html).toBe('')
  })

  it('锚点导航复用共享吸附栏外壳类（.dt-bar），不各写一份 chrome', () => {
    const anchorHtml = renderToStaticMarkup(
      createElement(AnchorNavBar, {
        title: '静安嘉里中心',
        items: [
          { id: 'sec-supply', label: '在租房源' },
          { id: 'sec-spec', label: '楼盘参数' },
        ],
      }),
    )
    const stickyHtml = renderToStaticMarkup(
      createElement(StickyInquiryBar, {
        title: '静安嘉里中心 12F',
        priceText: null,
        cta: createElement('button', { type: 'button' }, '预约看房'),
      }),
    )

    expect(anchorHtml).toContain('dt-bar dt-anchor-bar')
    expect(anchorHtml).toContain('dt-bar__inner')
    // StickyInquiryBar 默认隐藏（决策卡可见时不挂载），SSR 下为空串——
    // 这里只需要它不抛错即可，外壳类的另一半由 detail.css 的选择器保证。
    expect(stickyHtml).toBe('')
  })

  /**
   * 命题有两条，都钉在同一条 CSS 规则上：
   *   1. 落点补偿 = 导航高度 + 吸附条高度（+ 呼吸），不写死 100/112；
   *   2. `LocationPanel` 的 `<section id="location">`（类名由组件写死，外部
   *      加不上 `.dt-anchor-target`）与其它锚点目标**共用同一条声明**——它
   *      也是被锚点指向的区块，落点分叉就会出现「点周边与交通落到吸附条底下」
   *      以及「高亮比落点早/晚一格」（AnchorNavBar 的择一规则读的正是
   *      getComputedStyle 的 scrollMarginTop）。
   * 选择器写成列表还是两条独立规则不重要，重要的是两个选择器在同一条规则里，
   * 所以断言的是「同一个 { } 块同时覆盖两者」。
   */
  it('detail.css 的锚点落点补偿等于导航高度 + 吸附条高度，且 location-panel 共用同一条声明', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/app/(frontend)/styles/detail.css'),
      'utf8',
    )
    // 先剥注释：本文件的注释里会引用别处的 CSS 片段（如 styles.css 那条
    // `.location-panel { scroll-margin-top: 80px }`），不剥会先匹配到注释。
    const rule = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/(^|\})([^{}]*\.dt-anchor-target[^{}]*)\{([^}]*scroll-margin-top[^}]*)\}/m)
    expect(rule).not.toBeNull()
    expect(rule![3]).toMatch(
      /scroll-margin-top:\s*calc\(var\(--header-height\)\s*\+\s*var\(--dt-sticky-bar-h\)\s*\+\s*\d+px\)/,
    )
    expect(rule![2]).toMatch(/\.dt-page\s+\.location-panel/)
  })

  it('--dt-sticky-bar-h 定义在 :root，且没有任何 `, 56px` 字面兜底', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/app/(frontend)/styles/detail.css'),
      'utf8',
    )
    // 挂 :root 而不是 .dt-page —— `.dt-bar` / `.dt-anchor-target` 的使用范围
    // 不限于 .dt-page 子树（dev-story、以及把吸附条挂在页面根一级的接线）。
    expect(css).toMatch(/:root\s*\{[^}]*--dt-sticky-bar-h:\s*56px/)
    // 有了 :root 定义就不该再留静默回退：漏定义要直接暴露，不是走字面 56。
    expect(css).not.toMatch(/var\(--dt-sticky-bar-h\s*,/)
  })

})
