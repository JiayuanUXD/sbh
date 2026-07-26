import { getPayload } from 'payload'

import config from '../src/payload.config'

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

async function uploadMedia(
  payload: any,
  alt: string,
  url: string,
  filename: string,
): Promise<AnyDoc> {
  const buffer = await fetchImageBuffer(url)
  const media = await payload.create({
    collection: 'media',
    data: { alt },
    file: {
      data: buffer,
      mimetype: 'image/jpeg',
      name: `${filename}.jpg`,
      size: buffer.length,
    },
  })
  return media
}

async function deleteAllMedia(payload: any): Promise<void> {
  // seed.ts 幂等更新(非重建)后,listings/buildings/pages 仍持有对旧 media 的引用。
  // listings_gallery.image_id 为 NOT NULL,直接删 media 会触发外键约束失败,
  // 因此先解除所有引用(gallery 置空、coverImage/hero.image 置 null)再删。
  const unmountFromCollection = async (
    collection: 'listings' | 'buildings',
  ): Promise<void> => {
    const docs = await payload.find({ collection, limit: 1000, overrideAccess: true })
    for (const doc of docs.docs) {
      await payload.update({
        collection,
        id: doc.id,
        data: { coverImage: null, gallery: [] },
        overrideAccess: true,
      })
    }
  }
  await unmountFromCollection('listings')
  await unmountFromCollection('buildings')

  const pages = await payload.find({ collection: 'pages', limit: 1000, overrideAccess: true })
  for (const page of pages.docs) {
    if (page.hero?.image) {
      await payload.update({
        collection: 'pages',
        id: page.id,
        data: { hero: { ...page.hero, image: null } },
        overrideAccess: true,
      })
    }
  }

  const all = await payload.find({ collection: 'media', limit: 1000 })
  for (const doc of all.docs) {
    await payload.delete({ collection: 'media', id: doc.id })
  }
  payload.logger.info(`已清理旧 media: ${all.docs.length} 条`)
}

async function seedMedia() {
  const payload = await getPayload({ config })

  // 1) 清理旧占位图,避免媒体库堆积
  await deleteAllMedia(payload)

  // 2) 上传 5 张楼盘封面
  payload.logger.info('开始下载并上传楼盘封面图(picsum.photos)...')
  const covers: Record<string, AnyDoc> = {}
  for (const item of buildingCovers) {
    payload.logger.info(`下载封面: ${item.alt} (seed=${item.seed})`)
    const media = await uploadMedia(
      payload,
      item.alt,
      picsumUrl(item.seed, COVER_W, COVER_H),
      `cover-${item.slug}`,
    )
    covers[item.slug] = media
  }

  // 3) 上传 3 张室内细节图(共用)
  payload.logger.info('开始下载并上传室内细节图...')
  const galleryMedia: AnyDoc[] = []
  for (const item of galleryImages) {
    payload.logger.info(`下载细节图: ${item.alt} (seed=${item.seed})`)
    const media = await uploadMedia(
      payload,
      item.alt,
      picsumUrl(item.seed, GALLERY_W, GALLERY_H),
      `gallery-${galleryMedia.length + 1}`,
    )
    galleryMedia.push(media)
  }

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
  //    F7.1 E2E：所有 listings（不止 featured）都需要 gallery ≥ 3，否则
  //    有效供给精筛层 §6 会以 INSUFFICIENT_MEDIA 排除，导致前台 0 套房源。
  payload.logger.info('将封面与 gallery 同步到所有 listings...')
  const allListings = await payload.find({
    collection: 'listings',
    limit: 1000,
    overrideAccess: true,
  })
  for (const listing of allListings.docs) {
    const update: { coverImage?: number; gallery?: Array<{ image: number }> } = {}

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
    picsumUrl('shanghai-skyline-about-hero', COVER_W, COVER_H),
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

  payload.logger.info('媒体数据挂载完成。')
}

seedMedia()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
