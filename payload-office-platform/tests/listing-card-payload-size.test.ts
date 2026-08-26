import { describe, expect, it } from 'vitest'

import { mapListingCard } from '@/domain/public-catalog/mappers'

/**
 * 房源卡片的序列化体积（OPT-047）。
 *
 * ## 守的是什么
 *
 * 列表页的 `unstable_cache` 缓存的是 `buildListingSearchSource` 的**全量卡片数组**
 *（刻意设计：让 `?page=2` 不重跑最重的候选集查询）。所以条目体积
 * **∝ 该城市房源数 × 单张卡片大小**，而 Next.js 对单条缓存有 **2MB 硬上限**。
 *
 * 生产实测踩到：2,278,117 字节 → 缓存写入被拒 → `revalidate: 300` 完全没生效 →
 * 该路由每次请求都在真打库。
 *
 * **这个失败形态极其隐蔽**：页面照常 200，响应时间也不突变（单次查询本来就不慢），
 * 只有一行 stderr。没有任何外部信号，它已经这样跑了多久无从得知。
 *
 * ## 为什么断言「单张字节数」而不是「总量」
 *
 * 总量取决于生产有多少套房源，测试里造不出来。而**单张大小是可控的**，
 * 且与总量是简单乘法关系——守住单张就等于守住了增长空间。
 *
 * 阈值 1200 字节的来历：改动前 2160 → 改动后 886。取 1200 留约 35% 余量给正常的
 * 字段增补，同时对「有人把整个 building 或 blurDataURL 塞回来」这类回归足够敏感
 *（那会直接跳回 1300+ / 1400+）。
 */

/** 一条尽可能接近生产的房源原始记录（字段齐全、含楼盘与封面）。 */
function makeRawListing() {
  const blur = `data:image/png;base64,${'A'.repeat(600)}`
  return {
    id: 1,
    slug: 'huanqiu-jinrong-zhongxin-1201',
    title: '环球金融中心 280㎡ 精装带家具办公室',
    price: { amount: 5.5, currency: 'CNY', period: 'day', unit: 'sqm' },
    area: 280,
    floor: '12',
    seats: null,
    businessType: 'lease',
    decorationStatus: 'fully-furnished',
    listingType: 'traditional-office',
    availableFrom: '2026-09-01',
    isFeatured: false,
    highlights: [{ text: '地铁 2 号线直达' }, { text: '整层可分割' }, { text: '含家具' }],
    coverImage: {
      // id 是 isMedia 的硬条件，缺了封面映射成 null
      id: 101,
      url: '/api/media/file/listing-cover.jpg',
      width: 1600,
      height: 900,
      alt: '房源封面',
      blurDataUrl: blur,
    },
    building: {
      id: 4,
      slug: 'huangpu-bund',
      name: '外滩源大厦',
      address: '黄浦区中山东一路 100 号',
      grade: 'super-grade-a',
      summary: '外滩核心区超甲级办公，历史建筑与现代设施融合，配套成熟。',
      coordinates: { latitude: 31.2397, longitude: 121.4905 },
      coverImage: {
        id: 102,
        url: '/api/media/file/building-cover.jpg',
        width: 1600,
        height: 900,
        alt: '楼盘封面',
        blurDataUrl: blur,
      },
      // type/status 是 mapBuildingCity 的硬条件，缺了整张卡片映射成 null
      city: { id: 1, slug: 'shanghai', name: '上海', type: 'city', status: 'active' },
      district: { id: 6, slug: 'huangpu', name: '黄浦', type: 'district', status: 'active' },
    },
  }
}

describe('房源卡片序列化体积', () => {
  const card = mapListingCard(makeRawListing())

  it('能正常映射（夹具没写坏）', () => {
    expect(card).not.toBeNull()
  })

  it('单张卡片序列化后 < 1200 字节', () => {
    const bytes = JSON.stringify(card).length
    expect(
      bytes,
      `单张卡片 ${bytes} 字节。列表缓存存的是全量数组，1000 套就是 ${(bytes / 1024).toFixed(0)}KB——` +
        '超过 Next.js 的 2MB 单条上限后缓存写入会被静默拒绝，该路由退化成每次请求都打库。' +
        '若确需新增字段，请同步复核这个阈值，别直接调大。',
    ).toBeLessThan(1200)
  })

  it('不含 blurDataURL —— 全仓没有任何一处渲染它，纯死重（约 480 字节/张）', () => {
    const json = JSON.stringify(card)
    expect(json, '卡片里出现了 blurDataURL').not.toContain('blurDataURL')
    expect(json, '卡片里出现了 base64 内联图').not.toContain('data:image')
  })

  it('building 只保留卡片链路真正读取的字段', () => {
    // 逐个核实过消费方：ListingResultCard/Row 用 name；ListingCard 另用
    // address / district / grade / nearestMetro。其余在卡片链路上引用 0 次。
    const b = card!.building as Record<string, unknown> | null
    expect(b).not.toBeNull()
    for (const dropped of [
      'coverImage',
      'summary',
      'leasableArea',
      'listingCount',
      'completionDate',
      'typicalFloorArea',
      'airConditioning',
      'network',
      'parkingFee',
    ]) {
      expect(b, `building.${dropped} 不该出现在卡片里`).not.toHaveProperty(dropped)
    }
  })

  it('coordinates 必须保留 —— 首页「附近房源」用它算距离', () => {
    // 初版把它剔掉了，被 opt035-homepage-stats 抓住：
    // facade.ts:983 的 haversineKm(cityCenter, c.building.coordinates)。
    // 教训：扫消费方不能只扫 components 目录，domain 层也会读卡片 DTO。
    expect(card!.building).toHaveProperty('coordinates')
  })

  it('剔字段没有伤到卡片真正要用的数据', () => {
    // 收窄的边界必须验两侧：既要确认删对了，也要确认没删错。
    expect(card!.building).toMatchObject({ name: '外滩源大厦', grade: 'super-grade-a' })
    expect(card!.coverImage?.src).toContain('listing-cover.jpg')
    expect(card!.title).toContain('环球金融中心')
    expect(card!.price).not.toBeNull()
  })

  it('房源没有自己的封面时，仍回落到楼盘封面（兜底逻辑不能被收窄破坏）', () => {
    const raw = makeRawListing() as Record<string, unknown>
    delete raw.coverImage
    const fallback = mapListingCard(raw)
    expect(fallback!.coverImage?.src).toContain('building-cover.jpg')
    // 兜底来的封面同样不带 blur
    expect(JSON.stringify(fallback!.coverImage)).not.toContain('data:image')
  })
})
