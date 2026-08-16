import { getPayload } from 'payload'

import config from '../src/payload.config'
import { assertSeedTargetFromProcessEnv } from '../src/lib/runtime/seed-target-guard'
import type { Lead } from '../src/payload-types'
import { BUILTIN_ROLES } from '../src/test/factory/roles'
import { syncBuiltinRoles } from '../src/domain/auth/sync-builtin-roles'
import { CITY_SITE_PROFILE_SEEDS } from '../src/migrations/20260813_011000_seed_city_site_profiles'

type AnyDoc = {
  id: number
}

/**
 * 生成最简 Lexical 富文本 JSON（一个 h2 标题 + 若干段落），用于 seed 房源说明 / 内容页正文。
 * 结构对齐 src/test/frontend/payload-documents.ts 的 PAGE_CONTENT_SIMPLE，
 * 保证 RichText / PageContent 渲染器能正确消费。
 */
function richText(heading: string, paragraphs: string[]): Record<string, unknown> {
  return {
    root: {
      type: 'root',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      children: [
        {
          type: 'heading',
          tag: 'h2',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          children: [{ type: 'text', text: heading, version: 1, format: 0, style: '', mode: 'normal', detail: 0 }],
        },
        ...paragraphs.map((text) => ({
          type: 'paragraph',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          textFormat: 0,
          children: [{ type: 'text', text, version: 1, format: 0, style: '', mode: 'normal', detail: 0 }],
        })),
      ],
    },
  }
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
    // immutableCode 由 protectLocation hook 保证不可变，update 时带上它会被直接拒绝
    // （IMMUTABLE_CODE）。存量库里上海的码是历史遗留的 'SH'，若把它塞进 update，
    // seed 会在所有已有开发库上失败。更新只写可变字段，建码只在 create 时生效。
    const { immutableCode: _immutableCode, ...mutableData } = data
    return (await payload.update({
      collection,
      id: existing.docs[0].id,
      data: mutableData,
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
  // 目标环境守卫：seed 会大规模改写业务数据，指向生产库/生产桶一律 fail-fast。
  assertSeedTargetFromProcessEnv()

  console.log('--- Starting seed ---');
  console.log('Initializing payload...');
  const payload = await getPayload({ config })
  console.log('Payload initialized!');

  // === M1.2：内置角色种子（ADM / OPS / MGR / BRK / CSR）===
  // 内置角色不可删除或改码；重复 seed 时按 code 收敛名称、描述和权限。
  console.log('Syncing builtin roles...');
  await syncBuiltinRoles(
    {
      findByCode: async (code) => {
        const existing = await payload.find({
          collection: 'roles',
          where: { code: { equals: code } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        const role = existing.docs[0]
        return role
          ? { id: role.id, isBuiltin: role.isBuiltin }
          : undefined
      },
      update: async (id, role) => {
        await payload.update({
          collection: 'roles',
          id,
          data: {
            name: role.name,
            description: role.description,
            menuPermissions: role.menuPermissions,
            operationPermissions: role.operationPermissions,
            fieldPermissions: role.fieldPermissions,
          },
          overrideAccess: true,
        })
      },
      create: async (role) => {
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
      },
      info: (message) => payload.logger.info(message),
    },
    Object.values(BUILTIN_ROLES),
  )

  console.log('Builtin roles synced!');

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

  console.log('E2E Users synced!');

  console.log('Upserting locations...');
  const shanghai = await upsertBySlug<AnyDoc>(payload, 'locations', 'shanghai', {
    name: '上海',
    // 规范码（docs/geography-code-convention.md），与其余六城一致。
    // 存量开发库里已有的 'SH' 不会被改（immutableCode 不可变，见 upsertBySlug），
    // 收敛迁移也只在存在 LEGACY_LOC_1 时才动手，故老库继续用 'SH' 亦可正常工作。
    immutableCode: 'CITY-SH',
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

  // === OPT-027：六城城市节点（仅 city 层级，不带区县/商圈/地铁）===
  // CI 全新库里只有上面的上海，多城市 e2e（七城首页等）需要六城节点存在。
  // 名称/坐标/sortOrder 与 seed/geography/*.json 的城市头一致、字段口径对齐
  // scripts/import-geography.ts 的城市写入（frontendVisible: false），规范见
  // docs/geography-code-convention.md；后续真跑生产地理导入时按 immutableCode 幂等不冲突。
  const expansionCities = [
    { slug: 'nanjing', name: '南京市', immutableCode: 'CITY-NJ', sortOrder: 2, centerLatitude: 32.059344, centerLongitude: 118.796624 },
    { slug: 'hangzhou', name: '杭州市', immutableCode: 'CITY-HZ', sortOrder: 3, centerLatitude: 30.246566, centerLongitude: 120.209903 },
    { slug: 'suzhou', name: '苏州市', immutableCode: 'CITY-SZ', sortOrder: 4, centerLatitude: 31.299758, centerLongitude: 120.585294 },
    { slug: 'wuxi', name: '无锡市', immutableCode: 'CITY-WX', sortOrder: 5, centerLatitude: 31.491064, centerLongitude: 120.311889 },
    { slug: 'ningbo', name: '宁波市', immutableCode: 'CITY-NB', sortOrder: 6, centerLatitude: 29.860258, centerLongitude: 121.62454 },
    { slug: 'jiaxing', name: '嘉兴市', immutableCode: 'CITY-JX', sortOrder: 7, centerLatitude: 30.746814, centerLongitude: 120.755623 },
  ]
  for (const city of expansionCities) {
    await upsertBySlug<AnyDoc>(payload, 'locations', city.slug, {
      name: city.name,
      immutableCode: city.immutableCode,
      type: 'city',
      status: 'active',
      frontendVisible: false,
      sortOrder: city.sortOrder,
      centerLatitude: city.centerLatitude,
      centerLongitude: city.centerLongitude,
    })
  }

  // === OPT-027：七城站点档案（city-site-profiles）===
  // 迁移 20260813_011000 在全新空库会刻意跳过播种（城市晚于迁移由本脚本写入），
  // 因此这里复用该迁移导出的 CITY_SITE_PROFILE_SEEDS 补齐档案，文案零重复。
  // 上海档案的 cityCodes 别名含 'SH'，可直接挂上本脚本创建的上海节点（immutableCode 'SH'）。
  console.log('Upserting city site profiles...')
  for (const profileSeed of CITY_SITE_PROFILE_SEEDS) {
    // 与迁移同语义：按别名解析唯一启用城市，多个命中按别名优先级排序、数量异常则 fail fast
    const candidates = await payload.find({
      collection: 'locations',
      where: {
        and: [
          { immutableCode: { in: [...profileSeed.cityCodes] } },
          { type: { equals: 'city' } },
          { status: { equals: 'active' } },
        ],
      },
      limit: profileSeed.cityCodes.length,
      depth: 0,
      overrideAccess: true,
    })
    const ranked = (candidates.docs as Array<AnyDoc & { immutableCode: string }>)
      .filter((doc) => profileSeed.cityCodes.includes(doc.immutableCode))
      .sort(
        (left, right) =>
          profileSeed.cityCodes.indexOf(left.immutableCode) -
          profileSeed.cityCodes.indexOf(right.immutableCode),
      )
    if (ranked.length !== 1) {
      throw new Error(
        `city_site_profile_seed_conflict: immutable city codes ${profileSeed.cityCodes.join(', ')} matched ${ranked.length} active city rows`,
      )
    }

    const profileData = {
      city: ranked[0].id,
      serviceStatus: profileSeed.serviceStatus,
      switcherVisible: true,
      sortOrder: profileSeed.sortOrder,
      seoTitle: profileSeed.seoTitle,
      seoDescription: profileSeed.seoDescription,
      heroEyebrow: profileSeed.heroEyebrow,
      heroHeading: profileSeed.heroHeading,
      heroBody: profileSeed.heroBody,
      heroMedia: profileSeed.heroMediaId,
      introHeading: profileSeed.introHeading,
      introBody: profileSeed.introBody,
      contactHeading: profileSeed.contactHeading,
      contactBody: profileSeed.contactBody,
      featuredRegions: [],
    }
    const existing = await payload.find({
      collection: 'city-site-profiles',
      where: { city: { equals: ranked[0].id } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) {
      await payload.update({
        collection: 'city-site-profiles',
        id: existing.docs[0].id,
        data: profileData,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'city-site-profiles',
        data: profileData,
        overrideAccess: true,
      })
    }
  }
  console.log('City site profiles seeded!')

  const readyToMove = await upsertAmenity(payload, '可即刻入驻', 'office-service')
  const furnished = await upsertAmenity(payload, '精装带家具', 'space')
  const meetingRooms = await upsertAmenity(payload, '共享会议室', 'office-service')
  const metro = await upsertAmenity(payload, '近地铁', 'lifestyle')

  const westNanjingTower = await upsertBySlug<AnyDoc>(payload, 'buildings', 'west-nanjing-premium-center', {
    name: '南京西路高端商务中心',
    city: shanghai.id,
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

  // P0 building-detail acceptance: a real public building with no effective
  // listings. Keep it separate from held / pending-review fixtures so the
  // empty-state route proves that the facade does not invent supply.
  await upsertBySlug<AnyDoc>(payload, 'buildings', 'empty-building', {
    name: '静安待租楼盘',
    city: shanghai.id,
    status: 'published',
    operationalStatus: 'active',
    grade: 'grade-a',
    district: jingan.id,
    businessDistrict: nanjingWest.id,
    address: '上海市静安区南京西路 88 号',
    latitude: 31.228,
    longitude: 121.458,
    amenities: [metro.id],
    summary: '公开空间暂未释放，欢迎咨询后续供应计划。',
  })

  const lujiazuiTower = await upsertBySlug<AnyDoc>(payload, 'buildings', 'lujiazui-grade-a-river-view', {
    name: '陆家嘴江景甲级写字楼',
    city: shanghai.id,
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
    city: shanghai.id,
    status: 'published',
    grade: 'super-grade-a',
    district: huangpu.id,
    address: '黄浦区中山东一路',
    summary: '外滩核心区超甲级办公，历史建筑与现代设施融合。',
  })

  const bXuhui = await upsertBySlug<AnyDoc>(payload, 'buildings', 'xuhui-xujiahui', {
    name: '徐家汇国际大厦',
    city: shanghai.id,
    status: 'published',
    grade: 'grade-a',
    district: xuhui.id,
    address: '徐汇区虹桥路 1 号',
    summary: '徐家汇商圈甲级写字楼，近地铁 1/9/11 号线。',
  })

  const bChangning = await upsertBySlug<AnyDoc>(payload, 'buildings', 'changning-hongqiao', {
    name: '虹桥国际商务中心',
    city: shanghai.id,
    status: 'published',
    grade: 'grade-a',
    district: changning.id,
    address: '长宁区虹桥路',
    summary: '虹桥商务区核心办公，近虹桥枢纽。',
  })

  console.log('Locations and buildings seeded!');

  console.log('Upserting listings...');
  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-serviced-office-42-seats', {
    title: '静安南京西路 · 精装服务式办公室',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'serviced-office',
    building: westNanjingTower.id,
    rent: 2800,
    rentUnit: 'rmb-seat-month',
    area: 360,
    seats: 42,
    isFeatured: true,
    highlights: [{ text: '近地铁' }, { text: '可即刻入驻' }, { text: '带家具' }],
    availableFrom: '2026-08-01',
    description: richText('房源说明', [
      '位于静安南京西路核心商圈的精装服务式办公室，42 个独立工位，即租即用。',
      '配备全套办公家具、共享会议室与前台形象服务，7×24 门禁与智能空调，适合金融、咨询与消费品牌团队。',
      '步行 5 分钟可达地铁 2/12/13 号线，周边餐饮、酒店与商业配套齐全。',
    ]),
  })

  // P1 Task 4：媒体丰富房源，挂载图片/视频/平面图三类结构化媒体，供 detail-media E2E 验证。
  await upsertBySlug<AnyDoc>(payload, 'listings', 'media-rich-listing', {
    title: '南京西路 · 媒体样例房源',
    status: 'available',
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'serviced-office',
    building: westNanjingTower.id,
    rent: 3600,
    rentUnit: 'rmb-seat-month',
    area: 540,
    seats: 60,
    isFeatured: false,
    highlights: [{ text: '媒体齐全' }, { text: '近地铁' }, { text: '可即刻入驻' }],
    availableFrom: '2026-08-20',
    description: richText('房源说明', [
      '南京西路核心商圈服务式办公室，配套图片、视频与平面图三类媒体，便于详情页媒体体验验收。',
      '即租即用，带全套家具与共享会议室，适合中型团队入驻。',
    ]),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'lujiazui-grade-a-780sqm', {
    title: '陆家嘴核心区 · 江景甲级办公',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'traditional-office',
    building: lujiazuiTower.id,
    rent: 9.8,
    rentUnit: 'rmb-sqm-day',
    area: 780,
    seats: 95,
    isFeatured: true,
    highlights: [{ text: '高区视野' }, { text: '整层可谈' }, { text: '企业形象佳' }],
    availableFrom: '2026-09-01',
    description: richText('房源说明', [
      '陆家嘴核心区甲级写字楼高区单元，780㎡ 采光通透，正面江景视野。',
      '标准 9 尺层高、独立新风与中央空调，可整层或分割承租，适合总部办公与外资机构形象展示。',
      '楼下直连地铁 2 号线，紧邻国金中心与正大广场商业配套。',
    ]),
  })

  // === P0.3: 6 additional listings (total 8, varied listingType/rentUnit) ===
  await upsertBySlug<AnyDoc>(payload, 'listings', 'huangpu-bund-coworking', {
    title: '外滩源 · 共享办公 · 灵活工位',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'coworking',
    building: bHuangpu.id,
    rent: 1800,
    rentUnit: 'rmb-seat-month',
    area: 120,
    seats: 20,
    isFeatured: true,
    highlights: [{ text: '外滩景观' }, { text: '灵活租期' }, { text: '含网络水电' }],
    availableFrom: '2026-08-15',
    description: richText('房源说明', [
      '外滩源历史建筑内的共享办公空间，20 个灵活工位，按月起租，随到随办公。',
      '租金含高速网络、水电与公共区域清洁，配备共享会议室、茶水吧与打印区。',
      '适合初创团队、远程团队与项目制小组，享受外滩景观与历史街区氛围。',
    ]),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'pudong-lujiazui-fullfloor', {
    title: '陆家嘴 · 整层办公 1200㎡',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'full-floor',
    building: lujiazuiTower.id,
    rent: 10.5,
    rentUnit: 'rmb-sqm-day',
    area: 1200,
    seats: 150,
    isFeatured: false,
    highlights: [{ text: '整层独立' }, { text: '高区江景' }, { text: '企业冠名' }],
    availableFrom: '2026-10-01',
    description: richText('房源说明', [
      '陆家嘴甲级写字楼整层 1200㎡，独立电梯厅与门禁，可企业冠名。',
      '高区三面采光、正对黄浦江景，标准装修交付，支持按需定制平面与机电改造。',
      '适合金融机构、跨国企业上海总部与专业服务机构长期承租。',
    ]),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'xuhui-xujiahui-traditional', {
    title: '徐家汇 · 传统办公 200㎡',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'traditional-office',
    building: bXuhui.id,
    rent: 25000,
    rentUnit: 'rmb-month',
    area: 200,
    seats: 25,
    isFeatured: false,
    highlights: [{ text: '近地铁' }, { text: '毛坯交付' }, { text: '可定制装修' }],
    availableFrom: '2026-09-15',
    description: richText('房源说明', [
      '徐家汇商圈传统办公单元 200㎡，毛坯交付，可按企业需求定制装修。',
      '规整方正、无异形空间，可容纳约 25 个工位，独立水电计量。',
      '近地铁 1/9/11 号线徐家汇站，周边商业与交通配套成熟。',
    ]),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'changning-hongqiao-serviced', {
    title: '虹桥 · 服务式办公 180㎡',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'serviced-office',
    building: bChangning.id,
    rent: 3200,
    rentUnit: 'rmb-seat-month',
    area: 180,
    seats: 22,
    isFeatured: false,
    highlights: [{ text: '全配家具' }, { text: '即时入驻' }, { text: '近虹桥枢纽' }],
    availableFrom: '2026-08-20',
    description: richText('房源说明', [
      '虹桥商务区服务式办公室 180㎡，全套家具到位，签约即可入驻。',
      '含前台、保洁与会议室预约服务，网络水电打包计费，省去装修与运营成本。',
      '紧邻虹桥综合交通枢纽，高铁、机场与地铁 2/10/17 号线一站直达。',
    ]),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-center-fullfloor', {
    title: '静安 · 整层办公 850㎡',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'full-floor',
    building: westNanjingTower.id,
    rent: 11.0,
    rentUnit: 'rmb-sqm-day',
    area: 850,
    seats: 100,
    isFeatured: false,
    highlights: [{ text: '南京西路核心' }, { text: '整层独立' }, { text: '品牌展示' }],
    availableFrom: '2026-10-15',
    description: richText('房源说明', [
      '南京西路核心商务中心整层 850㎡，独立楼层，适合企业品牌展示与团队扩张。',
      '标准精装交付、独立会议区与开放办公区，中央空调与新风系统全覆盖。',
      '步行可达地铁 2/12/13 号线，周边高端零售、酒店与餐饮配套一应俱全。',
    ]),
  })

  // P0 detail-page acceptance: published effective supply whose price is
  // intentionally undisclosed. This is a real seed fixture for the
  // "价格面议，不显示 0 元" browser assertion.
  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-price-on-request-300sqm', {
    title: '静安 · 精装办公 300㎡ · 价格面议',
    status: 'available',
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'traditional-office',
    building: westNanjingTower.id,
    rent: null,
    rentUnit: 'rmb-sqm-day',
    area: 300,
    seats: 36,
    isFeatured: false,
    highlights: [{ text: '价格面议' }, { text: '近地铁' }, { text: '精装交付' }],
    availableFrom: '2026-09-01',
    description: richText('房源说明', [
      '静安核心区精装办公单元，约 300㎡，适合 30 至 40 人团队。',
      '当前租金需由顾问结合租期、交付需求和看房安排确认。',
    ]),
  })

  // Published and approved, but deliberately held for a supply recheck. This
  // remains a real REST-visible fixture while the public catalog must 404 it.
  // Do not add it to `allListingSlugs`: it must also lack an effective listing
  // merchant relation. Offline media seeding is safe because the hold alone is
  // sufficient to make it ineligible.
  await upsertBySlug<AnyDoc>(payload, 'listings', 'jingan-published-pending-recheck', {
    title: '静安 · 待复核办公 260㎡',
    status: 'available',
    reviewStatus: 'approved',
    publicationStatus: 'published',
    supplyVisibilityHold: 'pending_recheck',
    listingType: 'traditional-office',
    building: westNanjingTower.id,
    rent: 8.8,
    rentUnit: 'rmb-sqm-day',
    area: 260,
    seats: 30,
    isFeatured: false,
    highlights: [{ text: '待复核' }],
    availableFrom: '2026-09-01',
    description: richText('房源说明', ['该公开测试记录用于验证待复核供给不会被前台详情页展示。']),
  })

  await upsertBySlug<AnyDoc>(payload, 'listings', 'huangpu-bund-traditional', {
    title: '外滩 · 传统办公 500㎡',
    status: 'available',
    // F7.1 E2E：种子房源显式设为已审核 + 已发布，使其通过有效供给谓词
    reviewStatus: 'approved',
    publicationStatus: 'published',
    listingType: 'traditional-office',
    building: bHuangpu.id,
    rent: 70000,
    rentUnit: 'rmb-month',
    area: 500,
    seats: 60,
    isFeatured: false,
    highlights: [{ text: '外滩历史建筑' }, { text: '高端形象' }, { text: '适合金融/律所' }],
    availableFrom: '2026-11-01',
    description: richText('房源说明', [
      '外滩历史保护建筑内的传统办公单元 500㎡，兼具历史底蕴与现代办公设施。',
      '独立门牌与前厅，层高开阔，适合金融机构、律师事务所与高端服务机构塑造品牌形象。',
      '紧邻外滩金融集聚带，周边高端酒店、会所与商业配套完善。',
    ]),
  })

  console.log('Listings seeded!');

  // === 前端 CMS 内容页（pages/[slug] 路由）：标准内容页 + 法务页无 CTA 分支 ===
  // about：hero + 正文富文本 + SEO，页尾渲染 InquiryModal CTA。
  await upsertBySlug<AnyDoc>(payload, 'pages', 'about', {
    title: '关于我们',
    status: 'published',
    hero: {
      eyebrow: 'About Us',
      heading: '专注上海中高端商务办公租赁',
      summary: '以透明的房源信息与专业的选址顾问服务，帮助成长型企业高效落位。',
    },
    content: richText('我们做什么', [
      '我们聚合上海核心商圈的甲级写字楼、服务式办公室、共享办公与整层办公资源，为企业提供一站式选址服务。',
      '每一套对外展示的房源都经过审核与有效供给校验，确保信息真实、可租可看。',
      '专业顾问团队覆盖静安、浦东、黄浦、徐汇、长宁等核心区域，从需求梳理、实地看房到商务谈判全程陪同。',
    ]),
    seo: {
      title: '关于我们 · 中高端商务办公租赁平台',
      description: '专注上海中高端商务办公租赁，提供透明房源与专业选址顾问服务。',
    },
  })

  // privacy-policy：slug 以 privacy 开头，命中详情页法务分支——页尾不渲染 CTA。
  await upsertBySlug<AnyDoc>(payload, 'pages', 'privacy-policy', {
    title: '隐私政策',
    status: 'published',
    hero: {
      eyebrow: 'Privacy Policy',
      heading: '隐私政策',
      summary: '我们如何收集、使用与保护您在本平台留下的信息。',
    },
    content: richText('信息收集与使用', [
      '当您通过询价表单提交姓名与联系方式时，我们仅将其用于房源咨询与看房安排，不会出售给第三方。',
      '我们采用行业通行的安全措施保护您的个人信息，并按相关法律法规要求留存与销毁。',
      '如需查询、更正或删除您的信息，可通过页面公布的联系方式与我们联系。',
    ]),
    seo: {
      title: '隐私政策 · 中高端商务办公租赁平台',
      description: '了解本平台如何收集、使用与保护您的个人信息。',
    },
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

  console.log('Pages seeded!');

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

  console.log('Seeding leads...');
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

  console.log('Leads seeded! Seeding core mock data (teams, brokers, merchants)...');

  // ============================================================
  // 后台核心功能 mock 数据（M2.5 组织 / M3-M4 供给关系 / M5 CRM）
  // 种子数据全部幂等（find-then-create），走 overrideAccess。
  // 追加式流水（follow-ups / lead-ownership-history）只 create，按 lead 去重跳过。
  // ============================================================

  /** 通用 find-or-create：按 where 命中则复用，否则创建（不更新既有）。 */
  const findOrCreate = async (
    collection: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<AnyDoc> => {
    const existing = await payload.find({
      collection: collection as any,
      where: where as any,
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) return existing.docs[0] as AnyDoc
    return (await (payload as any).create({
      collection,
      data,
      overrideAccess: true,
    })) as AnyDoc
  }

  const userByEmail = async (email: string): Promise<number | string | null> => {
    const res = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return res.docs[0]?.id ?? null
  }

  const listingBySlug = async (slug: string): Promise<number | string | null> => {
    const res = await payload.find({
      collection: 'listings',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return res.docs[0]?.id ?? null
  }

  const leadByPhone = async (phone: string): Promise<AnyDoc | null> => {
    const res = await payload.find({
      collection: 'leads',
      where: { phone: { equals: phone } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return (res.docs[0] as AnyDoc | undefined) ?? null
  }

  // 未来一年，用于资质到期时间（valid 资质必须带未来到期时刻）
  const oneYearLater = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
  const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()

  // === (a) 团队 ===（cityScope 必须是启用的 city 节点；manager 可选）
  const mgrUserId = await userByEmail('e2e-mgr@example.com')
  const team1 = await findOrCreate(
    'teams',
    { name: { equals: '上海商办一队' } },
    {
      name: '上海商办一队',
      manager: mgrUserId ?? undefined,
      cityScope: [shanghai.id],
      status: 'active',
    },
  )

  // === (b) 经纪人 ===（一个 user ↔ 一个 broker，绑定不同 e2e 用户）
  const brkUserId = await userByEmail('e2e-brk@example.com')
  const csrUserId = await userByEmail('e2e-csr@example.com')
  const broker1 = brkUserId
    ? await findOrCreate(
        'brokers',
        { user: { equals: brkUserId } },
        {
          displayName: '陈经纪',
          user: brkUserId,
          team: team1.id,
          serviceCities: [shanghai.id],
          serviceBusinessAreas: [nanjingWest.id, lujiazui.id],
          employmentStatus: 'active',
        },
      )
    : null
  const broker2 = csrUserId
    ? await findOrCreate(
        'brokers',
        { user: { equals: csrUserId } },
        {
          displayName: '李经纪',
          user: csrUserId,
          team: team1.id,
          serviceCities: [shanghai.id],
          serviceBusinessAreas: [lujiazui.id],
          employmentStatus: 'active',
        },
      )
    : null

  // === (c) 商户 ===（服务城市含上海；资质 valid 必带未来到期时刻；有效手机号）
  const merchantOwner = await findOrCreate(
    'merchants',
    { name: { equals: '静安置业（业主）' } },
    {
      name: '静安置业（业主）',
      type: 'OWNER',
      contactName: '王经理',
      contactPhone: '13811112222',
      serviceCities: [shanghai.id],
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: oneYearLater,
    },
  )
  const merchantAgency = await findOrCreate(
    'merchants',
    { name: { equals: '浦东商办代理（中介）' } },
    {
      name: '浦东商办代理（中介）',
      type: 'AGENCY',
      contactName: '赵经理',
      contactPhone: '13822223333',
      serviceCities: [shanghai.id],
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: oneYearLater,
    },
  )

  // === (d) 供给关系 ===（楼盘关系 merchant 必填；房源关系 merchant 可选）
  // 楼盘已带 city，资格校验（building.city ∈ merchant.serviceCities）通过。
  await findOrCreate(
    'building-merchant-relations',
    { and: [{ building: { equals: westNanjingTower.id } }, { merchant: { equals: merchantOwner.id } }] },
    {
      building: westNanjingTower.id,
      merchant: merchantOwner.id,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      createdReason: '业主直营授权',
    },
  )
  await findOrCreate(
    'building-merchant-relations',
    { and: [{ building: { equals: lujiazuiTower.id } }, { merchant: { equals: merchantAgency.id } }] },
    {
      building: lujiazuiTower.id,
      merchant: merchantAgency.id,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      createdReason: '独家代理授权',
    },
  )

  const jinganListingId = await listingBySlug('jingan-serviced-office-42-seats')
  const lujiazuiListingId = await listingBySlug('lujiazui-grade-a-780sqm')
  if (jinganListingId) {
    await findOrCreate(
      'listing-merchant-relations',
      { and: [{ listing: { equals: jinganListingId } }, { merchant: { equals: merchantOwner.id } }] },
      {
        listing: jinganListingId,
        merchant: merchantOwner.id,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        createdReason: '房源挂牌授权',
      },
    )
  }
  if (lujiazuiListingId) {
    await findOrCreate(
      'listing-merchant-relations',
      { and: [{ listing: { equals: lujiazuiListingId } }, { merchant: { equals: merchantAgency.id } }] },
      {
        listing: lujiazuiListingId,
        merchant: merchantAgency.id,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        createdReason: '房源挂牌授权',
      },
    )
  }

  // === (d2) 全量房源-商户关系：F7.1 E2E 验收要求所有种子房源通过有效供给精筛
  //   精筛层 §8 要求 listing-merchant-relations 落在有效期；§9-§10 要求 listing.merchant
  //   字段引用合格商户（覆盖服务城市）。给所有 8 条房源补齐关系记录 + merchant 字段：
  //   - west-nanjing-premium-center 楼盘房源 → merchantOwner（业主直营）
  //   - 其他楼盘房源 → merchantAgency（独家代理）
  //   避免任一种子房源因 RELATION_NOT_EFFECTIVE / MERCHANT_INELIGIBLE 被 0 套排除。
  const allListingSlugs = [
    'jingan-serviced-office-42-seats',
    'lujiazui-grade-a-780sqm',
    'huangpu-bund-coworking',
    'pudong-lujiazui-fullfloor',
    'xuhui-xujiahui-traditional',
    'changning-hongqiao-serviced',
    'jingan-center-fullfloor',
    'jingan-price-on-request-300sqm',
    'huangpu-bund-traditional',
    'media-rich-listing',
  ]
  for (const slug of allListingSlugs) {
    const lid = await listingBySlug(slug)
    if (!lid) continue
    const building = await payload.find({
      collection: 'listings',
      where: { id: { equals: lid } },
      limit: 1,
      depth: 1,
      overrideAccess: true,
    })
    const buildingId = (building.docs[0] as any)?.building
    const buildingDoc =
      typeof buildingId === 'object'
        ? buildingId
        : (buildingId
          ? await payload.findByID({
              collection: 'buildings',
              id: buildingId as number,
              overrideAccess: true,
            })
          : null) as any
    const buildingSlug = buildingDoc?.slug as string | undefined
    // 同楼盘同商户的关系：jingan/west-nanjing 用 merchantOwner；其他用 merchantAgency
    const targetMerchant =
      buildingSlug === 'west-nanjing-premium-center' ? merchantOwner.id : merchantAgency.id
    await findOrCreate(
      'listing-merchant-relations',
      { and: [{ listing: { equals: lid } }, { merchant: { equals: targetMerchant } }] },
      {
        listing: lid,
        merchant: targetMerchant,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        createdReason: '房源挂牌授权（种子补齐）',
      },
    )
    // 同步 listings.merchant 字段，供 buildEffectiveSnapshot 精筛 §9-§10 使用
    await payload.update({
      collection: 'listings' as never,
      id: lid as never,
      data: { merchant: targetMerchant } as never,
      overrideAccess: true,
    })
  }

  // === (e) 客户档案 ===（按标准化手机号查重）
  const customer1 = await findOrCreate(
    'customers',
    { phoneNormalized: { equals: '13800138001' } },
    {
      name: '张磊',
      company: '上海蓝海科技',
      phoneNormalized: '13800138001',
      status: 'active',
    },
  )
  const customer2 = await findOrCreate(
    'customers',
    { phoneNormalized: { equals: '13900139002' } },
    {
      name: '李静',
      company: '环球咨询上海分公司',
      phoneNormalized: '13900139002',
      status: 'active',
    },
  )

  // === (f) 线索补充 M5 字段 ===（不设 ownershipStatus——由动作单一推导）
  const lead1 = await leadByPhone('13800138001')
  if (lead1 && broker1) {
    await payload.update({
      collection: 'leads',
      id: lead1.id,
      overrideAccess: true,
      data: {
        customer: customer1.id,
        owner: broker1.id,
        team: team1.id,
        city: shanghai.id,
        stage: 'following',
        areaMin: 300,
        areaMax: 500,
        budgetMin: 50000,
        budgetMax: 80000,
        currency: 'CNY',
        billingPeriod: 'month',
        seatCount: 60,
        leaseMonths: 24,
        specialRequirements: '需要独立会议室与前台形象。',
      },
    })
  }
  const lead2 = await leadByPhone('13900139002')
  if (lead2 && broker2) {
    await payload.update({
      collection: 'leads',
      id: lead2.id,
      overrideAccess: true,
      data: {
        customer: customer2.id,
        owner: broker2.id,
        team: team1.id,
        city: shanghai.id,
        stage: 'qualified',
        areaMin: 200,
        areaMax: 300,
        budgetMin: 30000,
        budgetMax: 50000,
        currency: 'CNY',
        billingPeriod: 'month',
        seatCount: 30,
        leaseMonths: 12,
      },
    })
  }

  // === (g) 跟进记录 ===（追加式，只 create；按 lead 去重；recommended 必带关联房源）
  const seedFollowUps = async (leadId: number | string, brokerId: number | string) => {
    const existing = await payload.find({
      collection: 'follow-ups',
      where: { lead: { equals: leadId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) return
    await (payload as any).create({
      collection: 'follow-ups',
      overrideAccess: true,
      data: {
        lead: leadId,
        broker: brokerId,
        method: 'phone',
        result: 'connected',
        content: '首次电话接通，客户确认选址需求与预算。',
        nextFollowUpAt: nextWeek,
      },
    })
    if (jinganListingId) {
      await (payload as any).create({
        collection: 'follow-ups',
        overrideAccess: true,
        data: {
          lead: leadId,
          broker: brokerId,
          method: 'wechat',
          result: 'recommended',
          content: '微信推荐静安服务式办公室，客户表示有兴趣。',
          relatedListings: [jinganListingId],
        },
      })
    }
  }
  if (lead1 && broker1) await seedFollowUps(lead1.id, broker1.id)

  // === (h) 归属历史 ===（追加式，只 create；按 lead+action 去重；负向动作必带原因）
  const seedOwnershipHistory = async (leadId: number | string, brokerId: number | string) => {
    const existing = await payload.find({
      collection: 'lead-ownership-history',
      where: { lead: { equals: leadId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs[0]) return
    // 分配（正向动作，无需原因）
    await (payload as any).create({
      collection: 'lead-ownership-history',
      overrideAccess: true,
      data: {
        lead: leadId,
        action: 'assign',
        toOwner: brokerId,
        operatedBy: mgrUserId ?? undefined,
      },
    })
    // 进入公海（负向动作，必带原因）
    await (payload as any).create({
      collection: 'lead-ownership-history',
      overrideAccess: true,
      data: {
        lead: leadId,
        action: 'to_public_pool',
        fromOwner: brokerId,
        reason: '超过首次跟进 SLA，自动进入公海。',
        operatedBy: mgrUserId ?? undefined,
      },
    })
  }
  if (lead2 && broker2) await seedOwnershipHistory(lead2.id, broker2.id)

  payload.logger.info('Seed data completed.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
