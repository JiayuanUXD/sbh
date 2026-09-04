import http from 'node:http'
import { URL } from 'node:url'

const sampleCover = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=80'
const sampleInterior = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&auto=format&fit=crop&q=80'
const sampleWorkstation = 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=600&auto=format&fit=crop&q=80'

function makeListing(id, slug, title, area, amount, unitText, district, buildingName, monthlyEstimate, highlights = ['近地铁', '精装修', '即租即用']) {
  return {
    id,
    slug,
    title,
    citySlug: 'shanghai',
    cityName: '上海',
    price: {
      amount,
      currency: 'CNY',
      businessType: 'lease',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: unitText,
      monthlyEstimate,
    },
    area,
    seats: Math.round(area / 8),
    listingType: { value: 'traditional-office', label: '传统办公' },
    availableFrom: '2026-09-01',
    building: {
      slug: 'heng-long-plaza',
      name: buildingName,
      address: '静安区南京西路1266号',
      district,
    },
    coverImage: {
      src: sampleCover,
      width: 800,
      height: 600,
      alt: title,
      blurDataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
    highlights,
  }
}

const mockListings = [
  makeListing('l-1', 'jingan-kerry-center-300sqm', '静安嘉里中心二座 · 高区带全套办公家具隔断办公', 320, 11.5, '11.5 元/㎡/天', '静安区', '静安嘉里中心', 110400, ['近地铁', '精装交付', '高层视野']),
  makeListing('l-2', 'heng-long-plaza-450sqm', '恒隆广场 · 稀缺整层双面采光近地铁直达精装商务单元', 450, 13.8, '13.8 元/㎡/天', '静安区', '恒隆广场', 186300, ['甲级地标', '配车位', '落地全景']),
  makeListing('l-3', 'shanghai-tower-280sqm', '上海中心大厦 · 陆家嘴超甲级云端商务中心独享套间', 280, 14.5, '14.5 元/㎡/天', '浦东新区', '上海中心大厦', 121800, ['超甲地标', '管家服务', '双层挑高']),
  makeListing('l-4', 'taikoo-hui-180sqm', '兴业太古汇 · 精装现房拎包入驻多功能独立洽谈室', 180, 12.0, '12.0 元/㎡/天', '静安区', '兴业太古汇', 64800, ['地铁上盖', '商业配套', '精装全配']),
]

const mockBuildings = [
  {
    id: 'b-1',
    slug: 'heng-long-plaza',
    name: '恒隆广场',
    district: '静安区',
    address: '南京西路1266号',
    grade: 'grade-a',
    completedYear: 2001,
    totalFloors: 66,
    occupancyRate: 95,
    activeListingCount: 4,
    priceRange: {
      min: 11.0,
      max: 15.0,
      unit: '元/㎡/天',
      displayUnit: 'rmb-sqm-day',
      text: '11.0 ~ 15.0 元/㎡/天',
    },
    coverImage: {
      src: sampleCover,
      width: 800,
      height: 600,
      alt: '恒隆广场',
    },
    nearestMetro: {
      line: '2/12/13号线',
      station: '南京西路',
      distanceMeters: 220,
    },
  },
  {
    id: 'b-2',
    slug: 'jingan-kerry-center',
    name: '静安嘉里中心',
    district: '静安区',
    address: '南京西路1515号',
    grade: 'grade-a',
    completedYear: 2013,
    totalFloors: 58,
    occupancyRate: 98,
    activeListingCount: 3,
    priceRange: {
      min: 10.5,
      max: 14.0,
      unit: '元/㎡/天',
      displayUnit: 'rmb-sqm-day',
      text: '10.5 ~ 14.0 元/㎡/天',
    },
    coverImage: {
      src: sampleInterior,
      width: 800,
      height: 600,
      alt: '静安嘉里中心',
    },
    nearestMetro: {
      line: '2/7号线',
      station: '静安寺',
      distanceMeters: 150,
    },
  },
  {
    id: 'b-3',
    slug: 'shanghai-tower',
    name: '上海中心大厦',
    district: '浦东新区',
    address: '银城中路501号',
    grade: 'super-grade-a',
    completedYear: 2016,
    totalFloors: 118,
    occupancyRate: 92,
    activeListingCount: 5,
    priceRange: {
      min: 12.0,
      max: 18.0,
      unit: '元/㎡/天',
      displayUnit: 'rmb-sqm-day',
      text: '12.0 ~ 18.0 元/㎡/天',
    },
    coverImage: {
      src: sampleWorkstation,
      width: 800,
      height: 600,
      alt: '上海中心大厦',
    },
    nearestMetro: {
      line: '2/14号线',
      station: '陆家嘴',
      distanceMeters: 310,
    },
  },
]

const mockInactiveBuildings = [
  {
    id: 'b-4',
    slug: 'plaza-66-tower2',
    name: '中环广场（整租满租）',
    district: '黄浦区',
    address: '淮海中路381号',
    grade: 'creative-park',
    completedYear: 1998,
    totalFloors: 38,
    occupancyRate: 100,
    activeListingCount: 0,
    priceRange: null,
    coverImage: {
      src: sampleInterior,
      width: 800,
      height: 600,
      alt: '中环广场',
    },
    nearestMetro: {
      line: '1号线',
      station: '黄陂南路',
      distanceMeters: 100,
    },
  },
]

const quickFilters = [
  {
    id: 'district',
    label: '区域',
    options: [
      { value: 'jingan', label: '静安区', count: 18 },
      { value: 'pudong', label: '浦东新区', count: 14 },
      { value: 'huangpu', label: '黄浦区', count: 10 },
      { value: 'xuhui', label: '徐汇区', count: 8 },
    ],
  },
  {
    id: 'listingType',
    label: '类型',
    options: [
      { value: 'traditional-office', label: '传统办公', count: 32 },
      { value: 'serviced-office', label: '商务中心', count: 12 },
      { value: 'creative-park', label: '创意园区', count: 6 },
    ],
  },
  {
    id: 'priceUnit',
    label: '计价',
    options: [
      { value: 'rmb-sqm-day', label: '元/㎡/天', count: 42 },
      { value: 'rmb-month', label: '元/月', count: 8 },
    ],
  },
]

export function createAcceptanceServer(port = 3717) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    const pathname = parsedUrl.pathname
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const meta = {
      requestId,
      asOf: new Date().toISOString(),
      maxAgeSeconds: 300,
    }

    // 1. Home endpoint
    if (pathname === '/api/mini/v1/home') {
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          featuredListings: mockListings,
          featuredBuildings: mockBuildings,
          quickFilters,
          stats: { listings: 88, buildings: 12, businessAreas: 8 },
        },
        meta,
      }))
      return
    }

    // 2. Listings endpoint
    if (pathname === '/api/mini/v1/listings') {
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          items: mockListings,
          pagination: {
            page: 1,
            pageSize: 24,
            totalDocs: mockListings.length,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
          canonicalQuery: '',
          currentPriceUnit: 'rmb-sqm-day',
          filters: quickFilters,
        },
        meta,
      }))
      return
    }

    // 3. Buildings endpoint
    if (pathname === '/api/mini/v1/buildings') {
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          items: mockBuildings,
          inactiveItems: mockInactiveBuildings,
          pagination: {
            page: 1,
            pageSize: 24,
            totalDocs: mockBuildings.length + mockInactiveBuildings.length,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
          totalActiveCount: mockBuildings.length,
          totalInactiveCount: mockInactiveBuildings.length,
        },
        meta,
      }))
      return
    }

    // 4. Building detail
    if (pathname.startsWith('/api/mini/v1/buildings/')) {
      const slug = pathname.replace('/api/mini/v1/buildings/', '')
      const b = mockBuildings.find(item => item.slug === slug) || mockBuildings[0]
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: b.id,
          slug: b.slug,
          name: b.name,
          address: b.address,
          district: b.district,
          grade: b.grade,
          completedYear: b.completedYear,
          totalFloors: b.totalFloors,
          standardFloorArea: 2200,
          elevators: { passenger: 16, cargo: 4 },
          parkingSpaces: 800,
          propertyManagementCompany: '第一太平戴维斯',
          propertyFee: 42,
          gallery: [
            { src: sampleCover, alt: b.name },
            { src: sampleInterior, alt: '大堂' },
            { src: sampleWorkstation, alt: '楼层走廊' },
          ],
          activeListingCount: mockListings.length,
          groupedListings: [
            {
              areaRange: '100 ~ 300 ㎡',
              count: 2,
              items: [mockListings[0], mockListings[3]],
            },
            {
              areaRange: '300 ~ 600 ㎡',
              count: 2,
              items: [mockListings[1], mockListings[2]],
            },
          ],
          nearestMetro: b.nearestMetro,
          comparableBuildings: mockBuildings.filter(x => x.slug !== b.slug),
          inquiryPolicy: { version: '2026-08-27' },
        },
        meta,
      }))
      return
    }

    // 5. Listing detail
    if (pathname.startsWith('/api/mini/v1/listings/')) {
      const slug = pathname.replace('/api/mini/v1/listings/', '')
      const l = mockListings.find(item => item.slug === slug) || mockListings[0]
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          listing: {
            ...l,
            gallery: [
              { src: sampleCover, alt: l.title },
              { src: sampleInterior, alt: '精装室内' },
              { src: sampleWorkstation, alt: '工位办公区' },
            ],
            building: {
              slug: 'heng-long-plaza',
              name: l.building.name,
              address: l.building.address,
              district: l.building.district,
              grade: 'grade-a',
              completedYear: 2001,
              totalFloors: 66,
              activeListingCount: 4,
              priceRange: {
                min: 11.0,
                max: 15.0,
                unit: '元/㎡/天',
                displayUnit: 'rmb-sqm-day',
                text: '11.0 ~ 15.0 元/㎡/天',
              },
              nearestMetro: {
                line: '2/12/13号线',
                station: '南京西路',
                distanceMeters: 220,
              },
            },
            factGroups: [
              {
                id: 'core',
                title: '核心规格',
                facts: [
                  { label: '楼层', value: '中高区 / 共 66 层', estimated: false },
                  { label: '工位数', value: `${l.seats || 35} 个`, estimated: false },
                  { label: '净高', value: '2.8 米', estimated: false },
                  { label: '朝向', value: '东南采光', estimated: false },
                ],
              },
            ],
            verification: {
              verifiedAt: '2026-09-01T00:00:00.000Z',
              priceVerifiedAt: '2026-09-01T00:00:00.000Z',
            },
            highlights: ['近地铁', '精装修', '即租即用', '高层视野采光好', '24小时独立空调'],
            comparables: mockListings.filter(x => x.slug !== l.slug),
          },
          monthlyCost: {
            currency: 'CNY',
            period: 'month',
            propertyFeeInclusion: 'included',
            rent: l.price.monthlyEstimate || 110400,
            propertyFee: 0,
            total: l.price.monthlyEstimate || 110400,
            assumptions: ['日租按 30 天折算月租，物业费已包含'],
          },
          relatedListings: [mockListings[1]],
          buildingInfo: mockBuildings[0],
          inquiryPolicy: {
            version: '2026-08-27',
          },
        },
        meta,
      }))
      return
    }

    // 6. Inquiry submission
    if (pathname === '/api/mini/v1/inquiries') {
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: 'inq-acceptance-test',
          submissionRequestId: 'req-acceptance-1',
          status: 'pending',
        },
        meta: { requestId },
      }))
      return
    }

    // Default fallback
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, data: {}, meta }))
  })

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`📡 自动化走查 Mock 服务已在 http://127.0.0.1:${port} 就绪`)
      resolve({
        server,
        close: () => new Promise(r => server.close(r)),
      })
    })
    server.on('error', reject)
  })
}
