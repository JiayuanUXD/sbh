/**
 * 走查夹具：给一座城市的站点配置挂一张全新的 hero 背景图，打印 id 与 URL。
 *
 * 用于「删 media 是否会让前台缓存立刻失效」的浏览器对照走查
 * （证据见 ../../../artifacts/verification/media-delete-cache/）。
 * 每跑一次造一张新图——走查会把图删掉，对照组与实验组必须各用一张。
 */
import sharp from 'sharp'
import { getPayload } from 'payload'

import config from '@/payload.config'

const CITY_SLUG = process.env.CITY_SLUG ?? 'shanghai'

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  const label = `walkthrough-${Date.now()}`
  const data = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#8a2b2b' },
  })
    .jpeg({ quality: 60 })
    .toBuffer()

  const media = await payload.create({
    collection: 'media',
    data: { alt: `走查用 hero 背景图 ${label}`, usage: 'other' },
    file: { data, mimetype: 'image/jpeg', name: `${label}.jpg`, size: data.length },
    overrideAccess: true,
  })

  const profiles = await payload.find({
    collection: 'city-site-profiles',
    where: { 'city.slug': { equals: CITY_SLUG } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const profile = profiles.docs[0]
  if (!profile) throw new Error(`找不到城市 ${CITY_SLUG} 的站点配置`)

  await payload.update({
    collection: 'city-site-profiles',
    id: profile.id,
    data: { heroMedia: media.id },
    overrideAccess: true,
  })

  console.log(JSON.stringify({ mediaId: media.id, url: media.url, profileId: profile.id }, null, 2))
  process.exit(0)
}

void main()
