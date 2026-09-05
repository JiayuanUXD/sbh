import { getPayload } from 'payload'
import sharp from 'sharp'

import config from '../src/payload.config'
import { assertSeedTargetFromProcessEnv } from '../src/lib/runtime/seed-target-guard'

// CI / 离线：不走外部网络（picsum.photos 慢且不稳），改用 sharp 本地合成纯色 JPEG。
// 有效供给精筛只看 gallery.length（≥3），不校验图片内容，占位纯色图完全够用。
const OFFLINE = !!process.env.CI || !!process.env.SEED_MEDIA_OFFLINE
const SOURCE_LABEL = OFFLINE ? 'sharp 本地生成' : 'picsum.photos 下载'

type AnyDoc = { id: number }

// 楼盘封面图(picsum.photos 真实摄影,seed 固定保证幂等)
const buildingCovers: Array<{ slug: string; alt: string; seed: string }> = [
  { slug: 'west-nanjing-premium-center', alt: '上海南京西路高端商务中心外景', seed: 'shanghai-nanjing-west-road-tower' },
  { slug: 'lujiazui-grade-a-river-view', alt: '上海陆家嘴江景甲级写字楼外景', seed: 'shanghai-lujiazui-skyscraper-river' },
  { slug: 'huangpu-bund', alt: '上海外滩源大厦历史建筑外景', seed: 'shanghai-bund-historic-architecture' },
  { slug: 'xuhui-xujiahui', alt: '上海徐家汇国际大厦外景', seed: 'shanghai-xujiahui-office-tower' },
  { slug: 'changning-hongqiao', alt: '上海虹桥国际商务中心外景', seed: 'shanghai-hongqiao-business-center' },
]

// 室内细节图(共用作为各 building 的 gallery)
const galleryImages: Array<{ alt: string; seed: string }> = [
  { alt: '现代办公楼开放式办公区', seed: 'modern-open-plan-workspace' },
  { alt: '精装会议室与城市景观', seed: 'premium-meeting-room-city-view' },
  { alt: '共享办公休闲区', seed: 'coworking-lounge-natural-light' },
]

const COVER_W = 1600
const COVER_H = 900
const GALLERY_W = 1200
const GALLERY_H = 900
// 一个内嵌的极小 MP4，保证离线 seed 也能覆盖详情页原生 video 控件的键盘行为。
const DETAIL_GALLERY_VIDEO_FIXTURE = 'AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29tAAADE21vb3YAAABsbXZoZAAAAACX513Ul+dd1AAAu4AAAHU7AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAKfdHJhawAAAFx0a2hkAAAAAZfnXdSX513UAAAAAQAAAAAAAHU7AAAAAAAAAAAAAAAAAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAB1OwAACEAAAQAAAAACF21kaWEAAAAgbWRoZAAAAACX513Ul+dd1AAAu4AAAIAAAAAAAAAAACJoZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAAAAAAAHNbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAGRc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgAAAASAgIAUQBUAGAAAAJhwAAAAAAWAgIACEZAGgICAAQIAAAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAIAAAAAEAAAAYc3R0cwAAAAAAAAABAAAAIAAABAAAAAAoc3RzYwAAAAAAAAACAAAAAQAAABgAAAABAAAAAgAAAAgAAAABAAAAlHN0c3oAAAAAAAAAAAAAACAAAAAGAAABqQAAAagAAAGDAAABIgAAAWEAAAGAAAABQgAAAUYAAAGAAAABwAAAAZIAAAFzAAABZAAAAYgAAAJiAAABWgAAAYEAAAFfAAABfAAAAiUAAAHNAAABOwAAAT0AAAE6AAABNAAAASEAAAEHAAABBgAAAR8AAAHMAAAABgAAABhzdGNvAAAAAAAAAAIAABAAAAAzGAAADM1mcmVlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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'

function picsumUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载图片失败 ${url}: ${res.status} ${res.statusText}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// 由 seed 字符串派生确定性 RGB，保证同 seed 生成同色（幂等、可辨识）。
function seedColor(seed: string): { r: number; g: number; b: number } {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return { r: (h >> 16) & 0xff, g: (h >> 8) & 0xff, b: h & 0xff }
}

// sharp 本地合成纯色 JPEG（无网络）。sharp 已是依赖（Payload 图片处理用）。
async function generateImageBuffer(seed: string, w: number, h: number): Promise<Buffer> {
  const background = seedColor(seed)
  return sharp({ create: { width: w, height: h, channels: 3, background } })
    .jpeg({ quality: 70 })
    .toBuffer()
}

// 统一图片来源：离线/CI 走 sharp 合成，否则拉 picsum.photos 真实摄影。
async function resolveImageBuffer(seed: string, w: number, h: number): Promise<Buffer> {
  return OFFLINE ? generateImageBuffer(seed, w, h) : fetchImageBuffer(picsumUrl(seed, w, h))
}

async function uploadMedia(
  payload: any,
  alt: string,
  seed: string,
  w: number,
  h: number,
  filename: string,
): Promise<AnyDoc> {
  const buffer = await resolveImageBuffer(seed, w, h)
  const media = await payload.create({
    collection: 'media',
    data: { alt, usage: 'other' },
    file: {
      data: buffer,
      mimetype: 'image/jpeg',
      name: `${filename}.jpg`,
      size: buffer.length,
    },
  })
  return media
}

async function uploadDetailGalleryVideoFixture(payload: any): Promise<AnyDoc> {
  const buffer = Buffer.from(DETAIL_GALLERY_VIDEO_FIXTURE, 'base64')
  return payload.create({
    collection: 'media',
    data: { alt: '详情页媒体画廊视频样本', usage: 'other' },
    file: {
      data: buffer,
      mimetype: 'video/mp4',
      name: 'detail-gallery-focus-fixture.mp4',
      size: buffer.length,
    },
  })
}

async function uploadHeroBackgroundVideo(payload: any): Promise<AnyDoc> {
  const buffer = Buffer.from(DETAIL_GALLERY_VIDEO_FIXTURE, 'base64')
  return payload.create({
    collection: 'media',
    data: { alt: '首页 hero 背景视频占位', usage: 'other' },
    file: {
      data: buffer,
      mimetype: 'video/mp4',
      name: 'hero-bg.mp4',
      size: buffer.length,
    },
  })
}

async function deleteAllMedia(payload: any): Promise<void> {
  // 这里曾有一段手工解引用（把 listings/buildings 的 gallery、mediaItems 清空，
  // 再把 pages.hero.image 置 null），理由是「listings_gallery.image_id 为 NOT NULL，
  // 直接删 media 会触发外键约束失败」。
  //
  // OPT-070 起不需要了：`Media` 的 beforeDelete（domain/media/media-delete-cleanup.ts）
  // 统一摘除数组子表引用，标量封面列本来就可空、由 PG 的 SET NULL 处理。
  //
  // 顺带去掉的是一个**维护陷阱**：那份清单要人肉跟着新表更新，OPT-060 新增
  // `city_site_profiles_type_card_overrides` 时没跟上，本脚本就断在那里
  //（见迁移 20260904_170123 的头注释）。钩子在数据库那一侧兜底，不会漏表。
  const all = await payload.find({ collection: 'media', limit: 1000 })
  for (const doc of all.docs) {
    await payload.delete({ collection: 'media', id: doc.id })
  }
  payload.logger.info(`已清理旧 media: ${all.docs.length} 条`)
}

async function seedMedia() {
  // 0) 目标环境守卫：必须排在 getPayload 之前。本脚本的每次上传都按同名 key 写对象存储，
  //    指向生产桶就会静默覆盖线上素材（真实事故：生产 hero-bg.mp4 被 15KB 占位 fixture 顶掉）。
  assertSeedTargetFromProcessEnv()

  const payload = await getPayload({ config })

  // 1) 清理旧占位图,避免媒体库堆积
  await deleteAllMedia(payload)

  // 2) 上传 5 张楼盘封面
  payload.logger.info(`开始上传楼盘封面图（${SOURCE_LABEL}）...`)
  const covers: Record<string, AnyDoc> = {}
  for (const item of buildingCovers) {
    payload.logger.info(`封面: ${item.alt} (seed=${item.seed})`)
    const media = await uploadMedia(
      payload,
      item.alt,
      item.seed,
      COVER_W,
      COVER_H,
      `cover-${item.slug}`,
    )
    covers[item.slug] = media
  }

  // 3) 上传 3 张室内细节图(共用)
  payload.logger.info(`开始上传室内细节图（${SOURCE_LABEL}）...`)
  const galleryMedia: AnyDoc[] = []
  for (const item of galleryImages) {
    payload.logger.info(`细节图: ${item.alt} (seed=${item.seed})`)
    const media = await uploadMedia(
      payload,
      item.alt,
      item.seed,
      GALLERY_W,
      GALLERY_H,
      `gallery-${galleryMedia.length + 1}`,
    )
    galleryMedia.push(media)
  }
  const detailGalleryVideo = await uploadDetailGalleryVideoFixture(payload)
  // 平面图单独一张：mediaItems 里 kind='floor-plan' 不计入 gallery（有效供给 §6 只数图片），
  // 复用室内细节图会让同一张图同时出现在「图片」和「平面图」两个分类里。
  payload.logger.info('平面图: 楼层平面示意图')
  const floorPlanMedia = await uploadMedia(
    payload,
    '楼层平面示意图',
    'office-floor-plan-schematic',
    GALLERY_W,
    GALLERY_H,
    'floor-plan-1',
  )

  // 4) 挂载到 buildings
  payload.logger.info('将图片挂载到楼盘...')
  for (const item of buildingCovers) {
    const existing = await payload.find({
      collection: 'buildings',
      limit: 1,
      where: { slug: { equals: item.slug } },
    })
    if (!existing.docs[0]) {
      payload.logger.warn(`未找到楼盘: ${item.slug},跳过`)
      continue
    }
    const coverMedia = covers[item.slug]
    await payload.update({
      collection: 'buildings',
      id: existing.docs[0].id,
      data: {
        coverImage: coverMedia.id,
        gallery: galleryMedia.map((m) => ({ image: m.id })),
      },
    })
    payload.logger.info(`已挂载: ${item.slug}`)
  }

  // 5) 同步到 featured listings：封面 + gallery
  //    前台可见性已不再看图片数（见 domain/review/effective-supply.ts 头部），
  //    这里仍给所有 listings 铺满 gallery：E2E 断言的是「有图的正常渲染」，
  //    无图降级另有其用例，不该靠种子数据碰运气。
  payload.logger.info('将封面与 gallery 同步到所有 listings...')
  const allListings = await payload.find({
    collection: 'listings',
    limit: 1000,
    overrideAccess: true,
  })
  for (const listing of allListings.docs) {
    const update: {
      coverImage?: number
      gallery?: Array<{ image: number }>
      mediaItems?: Array<{
        resource: number
        kind: 'image' | 'floor-plan' | 'video'
        category: 'exterior' | 'common-area' | 'workspace' | 'meeting-room'
        alt: string
        isSchematic?: boolean
      }>
    } = {}

    // 5.1 同步封面：从所属 building 取
    if (listing.building) {
      const building = await payload.findByID({
        collection: 'buildings',
        id: typeof listing.building === 'object' ? listing.building.id : listing.building,
      })
      if (building?.coverImage) {
        const coverId =
          typeof building.coverImage === 'object' ? building.coverImage.id : building.coverImage
        update.coverImage = coverId as number
      }
    }

    // 5.2 同步 gallery：所有房源统一挂载 3 张室内细节图，满足有效供给 §6（≥3）
    update.gallery = galleryMedia.map((m) => ({ image: m.id }))
    // 详情页焦点循环 E2E 需要一个真实的原生 video[controls]；仅稳定基准房源
    // 使用结构化媒体，其他房源仍沿用 legacy gallery。
    //
    // ⚠️ 结构化链路的 mediaItems 必须含 ≥3 条 kind='image'：syncListingMedia 会用
    // mediaItems 里的图片覆盖上面写入的 gallery，而视频与平面图不计入有效供给 §6
    // （supply-adapter 的 listings_gallery COUNT >= 3）。少于 3 张 → 房源被精筛剔除
    // → 详情页 404 → 全部 detail-* E2E 连带失败。
    if (listing.slug === 'jingan-serviced-office-42-seats') {
      update.mediaItems = [
        { resource: galleryMedia[0].id, kind: 'image', category: 'workspace', alt: '现代办公区' },
        { resource: detailGalleryVideo.id, kind: 'video', category: 'common-area', alt: '媒体画廊视频样本' },
        { resource: galleryMedia[1].id, kind: 'image', category: 'meeting-room', alt: '精装会议室' },
        { resource: galleryMedia[2].id, kind: 'image', category: 'common-area', alt: '共享休闲区' },
      ]
    } else if (listing.slug === 'media-rich-listing') {
      // P1 Task 4：图片 + 视频 + 平面图（示意图）三类媒体，供 detail-media E2E 验证。
      update.mediaItems = [
        { resource: galleryMedia[0].id, kind: 'image', category: 'workspace', alt: '现代办公区' },
        { resource: galleryMedia[1].id, kind: 'image', category: 'meeting-room', alt: '精装会议室' },
        { resource: galleryMedia[2].id, kind: 'image', category: 'common-area', alt: '共享休闲区' },
        { resource: detailGalleryVideo.id, kind: 'video', category: 'common-area', alt: '媒体画廊视频样本' },
        { resource: floorPlanMedia.id, kind: 'floor-plan', category: 'workspace', alt: '平面图示意图', isSchematic: true },
      ]
    } else {
      update.mediaItems = []
    }

    await payload.update({
      collection: 'listings',
      id: listing.id,
      data: update,
      overrideAccess: true,
    })
    payload.logger.info(`已挂载房源媒体: ${listing.slug}`)
  }

  // 6) 内容页 hero 图:为 about 页挂载 hero 封面,覆盖 pages/[slug] 的 hero-image 渲染路径
  payload.logger.info('为内容页 about 挂载 hero 图...')
  const aboutHero = await uploadMedia(
    payload,
    '关于我们页面 hero 配图:上海核心商圈天际线',
    'shanghai-skyline-about-hero',
    COVER_W,
    COVER_H,
    'page-about-hero',
  )
  const aboutPage = await payload.find({
    collection: 'pages',
    limit: 1,
    where: { slug: { equals: 'about' } },
    overrideAccess: true,
  })
  if (aboutPage.docs[0]) {
    const existingHero = (aboutPage.docs[0] as any).hero ?? {}
    await payload.update({
      collection: 'pages',
      id: aboutPage.docs[0].id,
      data: { hero: { ...existingHero, image: aboutHero.id } },
      overrideAccess: true,
    })
    payload.logger.info('已挂载 about 页 hero 图')
  } else {
    payload.logger.warn('未找到 about 页,跳过 hero 挂载')
  }

  // 7) 落地页 hero 装饰背景图:补传两张(CI/离线走 sharp 本地合成)。
  //    /entrust、/publish 硬编码 /api/media/file/landing-hero-{publish,entrust}-20260810.jpg?prefix=media。
  //    seed-media 的 deleteAllMedia 会删掉迁移建的 hero 记录但从不重传,导致 CI/dev 该 URL 404,
  //    浏览器 console 报错并撞上 landing-pages e2e 的 browserErrors 断言。此处按文件名原样重传字节。
  payload.logger.info(`上传落地页 hero 背景图（${SOURCE_LABEL}）...`)
  const landingHeroes: Array<{ filename: string; alt: string; colorSeed: string }> = [
    {
      filename: 'landing-hero-publish-20260810',
      alt: '高端写字楼空置空间与城市天际线背景',
      colorSeed: 'landing-hero-publish',
    },
    {
      filename: 'landing-hero-entrust-20260810',
      alt: '商务选址顾问会议桌与上海天际线背景',
      colorSeed: 'landing-hero-entrust',
    },
  ]
  for (const hero of landingHeroes) {
    payload.logger.info(`hero: ${hero.alt}`)
    await uploadMedia(payload, hero.alt, hero.colorSeed, COVER_W, COVER_H, hero.filename)
  }

  // 8) 首页 hero 背景视频:补传 hero-bg.mp4。
  //    HomeHeroMedia 硬编码 /api/media/file/hero-bg.mp4?prefix=media,deleteAllMedia 会删掉
  //    生产迁移建的记录但从不重传,导致 CI/dev 该 URL 403,浏览器 console 报错并撞上
  //    landing-pages e2e 的 browserErrors 断言。复用内嵌 MP4 fixture 补字节占位。
  payload.logger.info('上传首页 hero 背景视频 hero-bg.mp4...')
  await uploadHeroBackgroundVideo(payload)

  payload.logger.info('媒体数据挂载完成。')
}

seedMedia()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
