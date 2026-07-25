import { getPayload } from 'payload'

import config from '../src/payload.config'
import type { Lead } from '../src/payload-types'
import { BUILTIN_ROLES } from '../src/test/factory/roles'

type AnyDoc = {
  id: number
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

  // === M1.2：内置角色种子（ADM / OPS / MGR / BRK / CSR）===
  // 内置角色不可删除或改码；首次 seed 时创建，已存在则按 code 跳过。
  for (const role of Object.values(BUILTIN_ROLES)) {
    const existing = await payload.find({
      collection: 'roles',
      where: { code: { equals: role.code } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) {
      payload.logger.info(`角色 ${role.code} 已存在，跳过 seed`)
      continue
    }
    await payload.create({
      collection: 'roles',
      data: {
        code: role.code,
        name: role.name,
        description: role.description,
        isBuiltin: true,
        status: 'active',
        dataScope: role.dataScope,
        menuPermissions: role.menuPermissions,
        operationPermissions: role.operationPermissions,
        fieldPermissions: role.fieldPermissions,
      },
      overrideAccess: true,
    })
    payload.logger.info(`角色 ${role.code} 创建完成`)
  }

  // === M1.6：5 个 E2E 测试账号（每个内置角色一个）===
  // 仅在 dev/staging 环境用于权限矩阵 E2E；生产环境不应运行 seed。
  // 密码统一 Test1234!；邮箱 e2e-{rolecode lowercase}@example.com。
  // 已存在（按邮箱匹配）则更新 roles / status，避免重复创建。
  const e2eUsers: Array<{ code: string; name: string; email: string; password: string }> = [
    { code: 'ADM', name: 'E2E 管理员', email: 'e2e-adm@example.com', password: 'Test1234!' },
    { code: 'OPS', name: 'E2E 运营', email: 'e2e-ops@example.com', password: 'Test1234!' },
    { code: 'MGR', name: 'E2E 主管', email: 'e2e-mgr@example.com', password: 'Test1234!' },
    { code: 'BRK', name: 'E2E 经纪人', email: 'e2e-brk@example.com', password: 'Test1234!' },
    { code: 'CSR', name: 'E2E 客服', email: 'e2e-csr@example.com', password: 'Test1234!' },
  ]
  for (const u of e2eUsers) {
    const roleDoc = await payload.find({
      collection: 'roles',
      where: { code: { equals: u.code } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const roleId = roleDoc.docs[0]?.id
    if (!roleId) {
      payload.logger.warn(`E2E 用户 ${u.email} 缺少角色 ${u.code}，跳过`)
      continue
    }
    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: u.email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) {
      await payload.update({
        collection: 'users',
        id: existing.docs[0].id,
        data: { roles: [roleId], status: 'active' },
        overrideAccess: true,
      })
      payload.logger.info(`E2E 用户 ${u.email} 已存在，已更新角色绑定`)
      continue
    }
    // users 是 auth collection，Payload 类型对 create 有 draft 分支严格校验；
    // seed 脚本走 overrideAccess 直接写入，类型断言到 any 与脚本其余位置一致
    await (payload as any).create({
      collection: 'users',
      data: {
        name: u.name,
        email: u.email,
        password: u.password,
        roles: [roleId],
        status: 'active',
      },
      overrideAccess: true,
    })
    payload.logger.info(`E2E 用户 ${u.email} 创建完成`)
  }

  const shanghai = await upsertBySlug<AnyDoc>(payload, 'locations', 'shanghai', {
    name: '上海',
    immutableCode: 'SH',
    type: 'city',
    status: 'active',
    frontendVisible: true,
    description: '中高端商务办公租赁核心城市。',
    sortOrder: 1,
  })

  const jingan = await upsertBySlug<AnyDoc>(payload, 'locations', 'jingan', {
    name: '静安区',
    immutableCode: 'SH-JINGAN',
    type: 'district',
    status: 'active',
    frontendVisible: true,
    parent: shanghai.id,
    description: '南京西路、苏河湾等高端商务办公聚集区。',
    sortOrder: 10,
  })

  const pudong = await upsertBySlug<AnyDoc>(payload, 'locations', 'pudong', {
    name: '浦东新区',
    immutableCode: 'SH-PUDONG',
    type: 'district',
    status: 'active',
    frontendVisible: true,
    parent: shanghai.id,
    description: '陆家嘴、前滩等总部型企业办公聚集区。',
    sortOrder: 20,
  })

  const nanjingWest = await upsertBySlug<AnyDoc>(payload, 'locations', 'nanjing-west-road', {
    name: '南京西路',
    immutableCode: 'SH-JINGAN-NJW',
    type: 'business_area',
    status: 'active',
    frontendVisible: true,
    parent: jingan.id,
    description: '上海高端商务、零售与企业总部办公核心商圈。',
    sortOrder: 11,
  })

  const lujiazui = await upsertBySlug<AnyDoc>(payload, 'locations', 'lujiazui', {
    name: '陆家嘴',
    immutableCode: 'SH-PUDONG-LJZ',
    type: 'business_area',
    status: 'active',
    frontendVisible: true,
    parent: pudong.id,
    description: '金融、专业服务与跨国企业总部办公核心区域。',
    sortOrder: 21,
  })

  // === P0.3: 3 additional districts ===
  const huangpu = await upsertBySlug<AnyDoc>(payload, 'locations', 'huangpu', {
    name: '黄浦',
    immutableCode: 'SH-HUANGPU',
    type: 'district',
    status: 'active',
    frontendVisible: true,
    parent: shanghai.id,
    description: '外滩、人民广场等核心商务区。',
    sortOrder: 10,
  })

  const xuhui = await upsertBySlug<AnyDoc>(payload, 'locations', 'xuhui', {
    name: '徐汇',
    immutableCode: 'SH-XUHUI',
    type: 'district',
    status: 'active',
    frontendVisible: true,
    parent: shanghai.id,
    description: '徐家汇、漕河泾等商务办公聚集区。',
    sortOrder: 10,
  })

  const changning = await upsertBySlug<AnyDoc>(payload, 'locations', 'changning', {
    name: '长宁',
    immutableCode: 'SH-CHANGNING',
    type: 'district',
    status: 'active',
    frontendVisible: true,
    parent: shanghai.id,
    description: '虹桥、古北等国际化商务办公区域。',
    sortOrder: 10,
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

  // === P0.3: 3 additional buildings (one per new district) ===
  const bHuangpu = await upsertBySlug<AnyDoc>(payload, 'buildings', 'huangpu-bund', {
    name: '外滩源大厦',
    status: 'published',
    grade: 'super-grade-a',
    district: huangpu.id,
    address: '黄浦区中山东一路',
    summary: '外滩核心区超甲级办公，历史建筑与现代设施融合。',
  })

  const bXuhui = await upsertBySlug<AnyDoc>(payload, 'buildings', 'xuhui-xujiahui', {
    name: '徐家汇国际大厦',
    status: 'published',
    grade: 'grade-a',
    district: xuhui.id,
    address: '徐汇区虹桥路 1 号',
    summary: '徐家汇商圈甲级写字楼，近地铁 1/9/11 号线。',
  })

  const bChangning = await upsertBySlug<AnyDoc>(payload, 'buildings', 'changning-hongqiao', {
    name: '虹桥国际商务中心',
    status: 'published',
    grade: 'grade-a',
    district: changning.id,
    address: '长宁区虹桥路',
    summary: '虹桥商务区核心办公，近虹桥枢纽。',
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

  // === P0.3: 6 additional listings (total 8, varied listingType/rentUnit) ===
  await upsertBySlug<AnyDoc>(payload, 'listings', 'huangpu-bund-coworking', {
    title: '外滩源 · 共享办公 · 灵活工位',
    status: 'available',
    listingType: 'coworking',
    building: bHuangpu.id,
    rent: 1800,
    rentUnit: 'rmb-seat-month',
    area: 120,
    seats: 20,
    isFeatured: true,
    highlights: [{ text: '外滩景观' }, { text: '灵活租期' }, { text: '含网络水电' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'pudong-lujiazui-fullfloor', {
    title: '陆家嘴 · 整层办公 1200㎡',
    status: 'available',
    listingType: 'full-floor',
    building: lujiazuiTower.id,
    rent: 10.5,
    rentUnit: 'rmb-sqm-day',
    area: 1200,
    seats: 150,
    isFeatured: false,
    highlights: [{ text: '整层独立' }, { text: '高区江景' }, { text: '企业冠名' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'xuhui-xujiahui-traditional', {
    title: '徐家汇 · 传统办公 200㎡',
    status: 'available',
    listingType: 'traditional-office',
    building: bXuhui.id,
    rent: 25000,
    rentUnit: 'rmb-month',
    area: 200,
    seats: 25,
    isFeatured: false,
    highlights: [{ text: '近地铁' }, { text: '毛坯交付' }, { text: '可定制装修' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'changning-hongqiao-serviced', {
    title: '虹桥 · 服务式办公 180㎡',
    status: 'available',
    listingType: 'serviced-office',
    building: bChangning.id,
    rent: 3200,
    rentUnit: 'rmb-seat-month',
    area: 180,
    seats: 22,
    isFeatured: false,
    highlights: [{ text: '全配家具' }, { text: '即时入驻' }, { text: '近虹桥枢纽' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-center-fullfloor', {
    title: '静安 · 整层办公 850㎡',
    status: 'available',
    listingType: 'full-floor',
    building: westNanjingTower.id,
    rent: 11.0,
    rentUnit: 'rmb-sqm-day',
    area: 850,
    seats: 100,
    isFeatured: false,
    highlights: [{ text: '南京西路核心' }, { text: '整层独立' }, { text: '品牌展示' }],
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'huangpu-bund-traditional', {
    title: '外滩 · 传统办公 500㎡',
    status: 'available',
    listingType: 'traditional-office',
    building: bHuangpu.id,
    rent: 70000,
    rentUnit: 'rmb-month',
    area: 500,
    seats: 60,
    isFeatured: false,
    highlights: [{ text: '外滩历史建筑' }, { text: '高端形象' }, { text: '适合金融/律所' }],
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

  // === 扩展：Leads 咨询线索（覆盖各跟进状态，用于后台列表/筛选 UI 测试）===
  const leadsData: Array<
    Pick<
      Lead,
      | 'area'
      | 'budget'
      | 'company'
      | 'district'
      | 'interestedListing'
      | 'moveInTime'
      | 'name'
      | 'notes'
      | 'phone'
      | 'source'
      | 'status'
    >
  > = [
    {
      name: '张磊',
      phone: '13800138001',
      company: '上海蓝海科技',
      status: 'new',
      source: 'frontend-form',
      district: pudong.id,
      budget: '5-8 万/月',
      area: '300-500㎡',
      moveInTime: '2026-09',
      interestedListing: null,
      notes: '咨询陆家嘴甲级办公，看重企业形象与江景视野。',
    },
    {
      name: '李静',
      phone: '13900139002',
      company: '环球咨询上海分公司',
      status: 'contacted',
      source: 'frontend-form',
      district: jingan.id,
      budget: '3-5 万/月',
      area: '200-300㎡',
      moveInTime: '2026-08',
      interestedListing: null,
      notes: '已有经纪人电话联系，安排下周看房。',
    },
    {
      name: '王伟',
      phone: '13700137003',
      company: '锐智律师事务所',
      status: 'visited',
      source: 'phone',
      district: huangpu.id,
      budget: '7 万/月以上',
      area: '500㎡+',
      moveInTime: '2026-10',
      interestedListing: null,
      notes: '已实地看过外滩源大厦，对企业形象满意，正在谈价格。',
    },
    {
      name: '陈芳',
      phone: '13600136004',
      company: '欧憬品牌管理',
      status: 'won',
      source: 'frontend-form',
      district: jingan.id,
      budget: '2.8 万/月',
      area: '360㎡',
      moveInTime: '已入驻',
      interestedListing: null,
      notes: '已签约静安南京西路精装服务式办公室，42 工位。',
    },
    {
      name: '赵明',
      phone: '13500135005',
      company: '个人创业',
      status: 'new',
      source: 'frontend-form',
      district: huangpu.id,
      budget: '1.5 万/月',
      area: '工位 10-15',
      moveInTime: '2026-08',
      interestedListing: null,
      notes: '初创团队，咨询外滩共享办公灵活工位方案。',
    },
    {
      name: '刘洋',
      phone: '13400134006',
      company: '虹图建筑设计',
      status: 'contacted',
      source: 'import',
      district: xuhui.id,
      budget: '2.5 万/月',
      area: '200㎡',
      moveInTime: '2026-09',
      interestedListing: null,
      notes: '意向徐家汇传统办公，已发资料待回复。',
    },
    {
      name: '孙琪',
      phone: '13300133007',
      company: '联欧贸易',
      status: 'lost',
      source: 'phone',
      district: changning.id,
      budget: '6 万/月',
      area: '400㎡',
      moveInTime: '已搁置',
      interestedListing: null,
      notes: '预算与虹桥服务式办公报价差距较大，暂搁置。',
    },
    {
      name: '周涛',
      phone: '13200132008',
      company: '云启数据',
      status: 'new',
      source: 'frontend-form',
      district: pudong.id,
      budget: '10 万/月以上',
      area: '1000-1200㎡',
      moveInTime: '2026-10',
      interestedListing: null,
      notes: '总部升级需求，意向陆家嘴整层 1200㎡。',
    },
  ]

  for (const lead of leadsData) {
    const existing = await payload.find({
      collection: 'leads',
      limit: 1,
      where: { phone: { equals: lead.phone } },
    })
    if (existing.docs[0]) {
      await payload.update({ collection: 'leads', id: existing.docs[0].id, data: lead })
    } else {
      await payload.create({ collection: 'leads', data: lead })
    }
  }

  payload.logger.info('Seed data completed.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
