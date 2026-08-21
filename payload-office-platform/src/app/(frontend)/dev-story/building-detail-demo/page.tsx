import type { Metadata } from 'next'
import React from 'react'
import BuildingDetailLayout from '@/components/frontend/building-detail/BuildingDetailLayout'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
  ListingCardViewModel,
  MediaViewModel,
} from '@/domain/public-catalog'
import type { PoiByCategory } from '@/lib/frontend/location-pois'

/**
 * 楼盘详情重构 Demo 页（58 式 V2 布局）
 *
 * 用途：供产品/设计在不依赖真实楼盘数据的情况下预览新结构。
 * 开发/生产均可见（生产用于远程评审），robots noindex，页顶带演示横幅。
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '楼盘详情重构 Demo',
  robots: { index: false, follow: false },
}

// 媒体走 public/dev-story 同源静态资源：normalizePublicMediaUrl 只放行
// 同源路径与 http(s)，data: URL 会被安全守卫过滤。
const BASE_IMAGE: MediaViewModel = { src: '/dev-story/detail-demo-exterior.svg', alt: '楼盘示例图 · 外立面', width: 800, height: 500 }
const BASE_IMAGE_2: MediaViewModel = { src: '/dev-story/detail-demo-night.svg', alt: '楼盘示例图 · 夜景', width: 800, height: 500 }
const LOBBY_IMAGE: MediaViewModel = { src: '/dev-story/detail-demo-lobby.svg', alt: '楼盘示例图 · 大堂', width: 800, height: 500 }
const FLOOR_PLAN: MediaViewModel = { src: '/dev-story/detail-demo-floorplan.svg', alt: '平面图示意', width: 400, height: 300 }

function listingCard(overrides: Partial<ListingCardViewModel> & { id: number; slug: string; title: string }): ListingCardViewModel {
  return {
    citySlug: overrides.citySlug ?? 'shanghai',
    cityName: overrides.cityName ?? '上海市',
    id: overrides.id,
    slug: overrides.slug,
    title: overrides.title,
    price: overrides.price ?? {
      amount: 8.5,
      currency: 'CNY',
      businessType: 'lease',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: '8.5 元/㎡/天',
    },
    area: overrides.area ?? 220,
    floor: overrides.floor ?? null,
    seats: overrides.seats ?? null,
    businessType: 'lease',
    decorationStatus: 'furnished',
    listingType: 'traditional-office',
    availableFrom: '2026-08-01',
    isFeatured: false,
    building: overrides.building ?? null,
    coverImage: overrides.coverImage ?? null,
    highlights: overrides.highlights ?? ['近地铁', '可分割', '精装交付'],
    stableSortKey: `listing-${overrides.id}`,
  }
}

// 12 套房源：触发精确筛选表单（>10 阈值）与面积分桶、表格视图
const DEMO_AREAS = [88, 120, 156, 210, 260, 320, 450, 520, 680, 880, 1100, 1500] as const

const FIXTURE_LISTINGS: ListingCardViewModel[] = DEMO_AREAS.map((area, index) => {
  const unitPrice = Number((7.5 + index * 0.3).toFixed(1))
  return listingCard({
    id: 101 + index,
    slug: `demo-${area}`,
    title: `Demo 国际商务中心 · ${area}㎡ 办公`,
    area,
    price: {
      amount: unitPrice,
      currency: 'CNY',
      businessType: 'lease',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: `${unitPrice} 元/㎡/天`,
    },
    coverImage: index % 3 === 0 ? FLOOR_PLAN : index % 3 === 1 ? BASE_IMAGE : BASE_IMAGE_2,
  })
})

const FIXTURE_BUILDING: BuildingDetailViewModel = {
  citySlug: 'shanghai',
  cityName: '上海市',
  id: 1,
  slug: 'demo-tower',
  name: 'Demo 国际商务中心',
  address: '上海市浦东新区世纪大道 1000 号',
  buildingType: 'office_building',
  grade: 'super-grade-a',
  district: { id: 1, slug: 'pudong', name: '浦东' },
  businessDistrict: { id: 2, slug: 'lujiazui', name: '陆家嘴' },
  nearestMetro: { id: 3, slug: 'lujiazui-station', name: '陆家嘴站' },
  coverImage: BASE_IMAGE,
  gallery: [BASE_IMAGE],
  mediaItems: [
    { id: 'm1', kind: 'image', category: 'exterior', resource: BASE_IMAGE, capturedAt: null, isSchematic: false },
    { id: 'm2', kind: 'image', category: 'exterior', resource: BASE_IMAGE_2, capturedAt: null, isSchematic: false },
    { id: 'm3', kind: 'image', category: 'common-area', resource: LOBBY_IMAGE, capturedAt: null, isSchematic: false },
    { id: 'm4', kind: 'floor-plan', category: 'common-area', resource: FLOOR_PLAN, capturedAt: null, isSchematic: true },
  ],
  factGroups: [
    {
      id: 'fg1',
      title: '基本参数',
      facts: [
        { label: '物业类型', value: '写字楼', estimated: false, critical: false },
        { label: '楼宇等级', value: '超甲级', estimated: false, critical: false },
        { label: '竣工时间', value: '2018年', estimated: false, critical: false },
        { label: '总楼层', value: '38层', estimated: false, critical: false },
        { label: '标准层面积', value: '约 2200 ㎡', estimated: true, critical: false },
        { label: '层高', value: '4.2 m', estimated: false, critical: false },
        { label: '建筑面积', value: '150800 ㎡', estimated: false, critical: false },
      ],
    },
    {
      id: 'fg2',
      title: '楼宇服务',
      facts: [
        { label: '物业公司', value: 'Demo 物业', estimated: false, critical: false },
        { label: '物业费', value: '35 元/㎡/月', estimated: false, critical: false },
        { label: '空调', value: '中央空调', estimated: false, critical: false },
        { label: '停车位', value: '约 800 个', estimated: true, critical: false },
      ],
    },
  ],
  amenityGroups: [],
  verification: {
    verifiedAt: '2026-07-01',
    priceVerifiedAt: '2026-07-15',
  },
  amenities: ['24小时安保', '智能门禁', '员工餐厅', '会议室', '健身房', '快递柜'],
  summary: '位于陆家嘴核心区的超甲级写字楼，坐拥黄浦江景，地铁 2/14 号线直达。',
  description: {
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'Demo 国际商务中心是陆家嘴金融城的标志性建筑之一，提供灵活可分割的办公空间，适合金融、科技及专业服务类企业入驻。双大堂设计，标准层面积约 2200 ㎡，得房率约 70%。',
            },
          ],
        },
      ],
    },
  } as unknown as BuildingDetailViewModel['description'],
  coordinates: { latitude: 31.2304, longitude: 121.4737 },
}

const DEMO_PRICE_MIN = 7.5
const DEMO_PRICE_MAX = Number((7.5 + (DEMO_AREAS.length - 1) * 0.3).toFixed(1))

const FIXTURE_SUPPLY: BuildingSupplySnapshot = {
  asOf: new Date().toISOString(),
  groups: [
    {
      key: 'lease',
      listings: FIXTURE_LISTINGS,
      priceRanges: [
        {
          key: 'lease:CNY:day:sqm',
          businessType: 'lease',
          currency: 'CNY',
          period: 'day',
          basis: 'sqm',
          displayUnit: 'rmb-sqm-day',
          min: DEMO_PRICE_MIN,
          max: DEMO_PRICE_MAX,
          count: FIXTURE_LISTINGS.length,
        },
      ],
      areaRange: { min: DEMO_AREAS[0], max: DEMO_AREAS[DEMO_AREAS.length - 1] },
      seatRange: null,
      immediateAvailabilityCount: FIXTURE_LISTINGS.length,
    },
  ],
  availableGroups: [
    {
      key: 'lease',
      totalEffectiveListings: FIXTURE_LISTINGS.length,
      areaRange: { min: DEMO_AREAS[0], max: DEMO_AREAS[DEMO_AREAS.length - 1] },
      seatRange: null,
      immediateAvailabilityCount: FIXTURE_LISTINGS.length,
      priceRanges: [
        {
          key: 'lease:CNY:day:sqm',
          businessType: 'lease',
          currency: 'CNY',
          period: 'day',
          basis: 'sqm',
          displayUnit: 'rmb-sqm-day',
          min: DEMO_PRICE_MIN,
          max: DEMO_PRICE_MAX,
          count: FIXTURE_LISTINGS.length,
        },
      ],
    },
  ],
  totalEffectiveListings: FIXTURE_LISTINGS.length,
  resultCount: FIXTURE_LISTINGS.length,
  validationErrors: [],
}

const FIXTURE_RELATED_BASE = [
  { id: 2, slug: 'related-a', name: 'Related 金融中心', address: '上海市浦东新区银城中路 200 号', grade: 'grade-a', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: BASE_IMAGE },
  { id: 3, slug: 'related-b', name: 'Related 世纪汇', address: '上海市浦东新区世纪大道 1200 号', grade: 'grade-a', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: BASE_IMAGE_2 },
  { id: 4, slug: 'related-c', name: 'Related 江景大厦', address: '上海市浦东新区滨江大道 300 号', grade: 'super-grade-a', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: LOBBY_IMAGE },
  { id: 5, slug: 'related-d', name: 'Related 科创园', address: '上海市浦东新区张江路 500 号', grade: 'creative-park', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: BASE_IMAGE },
  { id: 6, slug: 'related-e', name: 'Related 环球港', address: '上海市浦东新区浦东南路 800 号', grade: 'grade-a', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: BASE_IMAGE_2 },
  { id: 7, slug: 'related-f', name: 'Related 东方广场', address: '上海市浦东新区东方路 600 号', grade: 'grade-a', district: { id: 1, slug: 'pudong', name: '浦东' }, coverImage: undefined },
] satisfies readonly Omit<BuildingSummaryViewModel, 'citySlug' | 'cityName'>[]

const FIXTURE_RELATED: BuildingSummaryViewModel[] = FIXTURE_RELATED_BASE.map((building) => ({
  citySlug: 'shanghai',
  cityName: '上海市',
  ...building,
}))

const FIXTURE_POIS: PoiByCategory = {
  transport: [
    { id: 't1', name: '陆家嘴站', category: 'transport', subCategory: 'subway', distanceMeters: 320, direction: '步行约 4 分钟', metroLines: ['2号线', '14号线'], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
    { id: 't2', name: '世纪大道浦东南路站', category: 'transport', subCategory: 'bus', distanceMeters: 180, direction: '东南', metroLines: [], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
  ],
  restaurant: [
    { id: 'r1', name: 'Demo 员工餐厅', category: 'restaurant', subCategory: null, distanceMeters: 50, direction: '楼内', metroLines: [], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
    { id: 'r2', name: '陆家嘴美食广场', category: 'restaurant', subCategory: null, distanceMeters: 260, direction: '北', metroLines: [], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
  ],
  bank: [
    { id: 'b1', name: 'Demo 银行支行', category: 'bank', subCategory: null, distanceMeters: 120, direction: '西', metroLines: [], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
  ],
  hotel: [
    { id: 'h1', name: 'Demo 酒店', category: 'hotel', subCategory: null, distanceMeters: 410, direction: '西南', metroLines: [], coordinates: { latitude: 31.2304, longitude: 121.4737 }, source: 'amap-location-service', fetchedAt: new Date().toISOString() },
  ],
}

export default function BuildingDetailDemoPage() {
  return (
    <>
      <p className="dev-story-banner" role="note">
        演示页：数据为虚拟 fixture，仅用于评审详情页重构结构，非真实楼盘信息
      </p>
      <BuildingDetailLayout
        building={FIXTURE_BUILDING}
        supply={FIXTURE_SUPPLY}
        relatedBuildings={FIXTURE_RELATED}
        pois={FIXTURE_POIS}
        mapEnabled={true}
        supplyCurrentSearch=""
      />
    </>
  )
}
