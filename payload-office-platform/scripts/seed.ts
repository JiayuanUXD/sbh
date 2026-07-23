import { getPayload } from 'payload'

import config from '../src/payload.config'

type AnyDoc = {
  id: string | number
}

async function upsertBySlug<T extends AnyDoc>(
  payload: any,
  collection: 'locations' | 'buildings' | 'listings' | 'pages',
  slug: string,
  data: Record<string, unknown>,
): Promise<T> {
  const existing = await payload.find({
    collection,
    limit: 1,
    where: {
      slug: {
        equals: slug,
      },
    },
  })

  if (existing.docs[0]) {
    return (await payload.update({
      collection,
      id: existing.docs[0].id,
      data,
    })) as T
  }

  return (await payload.create({
    collection,
    data: {
      ...data,
      slug,
    },
  })) as T
}

async function upsertAmenity(
  payload: any,
  name: string,
  category: 'office-service' | 'space' | 'building' | 'lifestyle',
): Promise<AnyDoc> {
  const existing = await payload.find({
    collection: 'amenities',
    limit: 1,
    where: {
      name: {
        equals: name,
      },
    },
  })

  if (existing.docs[0]) {
    return (await payload.update({
      collection: 'amenities',
      id: existing.docs[0].id,
      data: { category },
    })) as AnyDoc
  }

  return (await payload.create({
    collection: 'amenities',
    data: { name, category },
  })) as AnyDoc
}

async function seed() {
  const payload = await getPayload({ config })

  const shanghai = await upsertBySlug<AnyDoc>(payload, 'locations', 'shanghai', {
    name: '上海',
    type: 'city',
    description: '中高端商务办公租赁核心城市。',
    sortOrder: 1,
  })

  const jingan = await upsertBySlug<AnyDoc>(payload, 'locations', 'jingan', {
    name: '静安区',
    type: 'district',
    parent: shanghai.id,
    description: '南京西路、苏河湾等高端商务办公聚集区。',
    sortOrder: 10,
  })

  const pudong = await upsertBySlug<AnyDoc>(payload, 'locations', 'pudong', {
    name: '浦东新区',
    type: 'district',
    parent: shanghai.id,
    description: '陆家嘴、前滩等总部型企业办公聚集区。',
    sortOrder: 20,
  })

  const nanjingWest = await upsertBySlug<AnyDoc>(payload, 'locations', 'nanjing-west-road', {
    name: '南京西路',
    type: 'business-district',
    parent: jingan.id,
    description: '上海高端商务、零售与企业总部办公核心商圈。',
    sortOrder: 11,
  })

  const lujiazui = await upsertBySlug<AnyDoc>(payload, 'locations', 'lujiazui', {
    name: '陆家嘴',
    type: 'business-district',
    parent: pudong.id,
    description: '金融、专业服务与跨国企业总部办公核心区域。',
    sortOrder: 21,
  })

  const readyToMove = await upsertAmenity(payload, '可即刻入驻', 'office-service')
  const furnished = await upsertAmenity(payload, '精装带家具', 'space')
  const meetingRooms = await upsertAmenity(payload, '共享会议室', 'office-service')
  const metro = await upsertAmenity(payload, '近地铁', 'lifestyle')

  const westNanjingTower = await upsertBySlug<AnyDoc>(payload, 'buildings', 'west-nanjing-premium-center', {
    name: '南京西路高端商务中心',
    status: 'published',
    grade: 'serviced-office',
    district: jingan.id,
    businessDistrict: nanjingWest.id,
    address: '上海市静安区南京西路商圈',
    latitude: 31.229,
    longitude: 121.459,
    amenities: [readyToMove.id, furnished.id, meetingRooms.id, metro.id],
    summary: '面向金融、咨询、消费品牌和成长型团队的高端服务式办公空间。',
  })

  const lujiazuiTower = await upsertBySlug<AnyDoc>(payload, 'buildings', 'lujiazui-grade-a-river-view', {
    name: '陆家嘴江景甲级写字楼',
    status: 'published',
    grade: 'grade-a',
    district: pudong.id,
    businessDistrict: lujiazui.id,
    address: '上海市浦东新区陆家嘴核心区',
    latitude: 31.239,
    longitude: 121.499,
    amenities: [furnished.id, metro.id],
    summary: '适合总部办公、专业服务机构和外资企业形象展示。',
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-serviced-office-42-seats', {
    title: '静安南京西路 · 精装服务式办公室',
    status: 'available',
    listingType: 'serviced-office',
    building: westNanjingTower.id,
    rent: 2800,
    rentUnit: 'rmb-seat-month',
    area: 360,
    seats: 42,
    isFeatured: true,
    highlights: [{ text: '近地铁' }, { text: '可即刻入驻' }, { text: '带家具' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'lujiazui-grade-a-780sqm', {
    title: '陆家嘴核心区 · 江景甲级办公',
    status: 'available',
    listingType: 'traditional-office',
    building: lujiazuiTower.id,
    rent: 9.8,
    rentUnit: 'rmb-sqm-day',
    area: 780,
    seats: 95,
    isFeatured: true,
    highlights: [{ text: '高区视野' }, { text: '整层可谈' }, { text: '企业形象佳' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'pages', 'home', {
    title: '中高端商务办公租赁平台首页',
    status: 'published',
    hero: {
      eyebrow: 'Shanghai Premium Office Leasing',
      heading: '为成长型企业匹配更体面的上海办公室',
      summary: '聚合甲级写字楼、服务式办公室、共享办公与整层办公机会。',
    },
    seo: {
      title: '中高端商务办公租赁平台',
      description: '上海甲级写字楼、服务式办公室、共享办公与整层办公租赁平台。',
    },
  })

  payload.logger.info('Seed data completed.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
