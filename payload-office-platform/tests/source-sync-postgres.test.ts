import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import sharp from 'sharp'

import config from '@/payload.config'
import type { HuizuBuildingRow, HuizuListingRow, HuizuSyncRow } from '@/domain/supply-sync/huizuxuanzhi-row'
import { rollbackSourceSyncBatch } from '@/domain/supply-sync/source-sync-rollback'
import { runSourceSyncSlice, shouldWaitForBuildings } from '@/domain/supply-sync/source-sync-task'

/**
 * OPT-104 外部来源同步任务真库测试：直接驱动 `runSourceSyncSlice`，不经 jobs 队列。
 *
 * 覆盖 §5.2 的写入规则：新建一律草稿；房源覆盖采集字段、楼盘只填空；状态与商户在更新时不动；
 * 只有已上架的旧房源会被下架、成交终态不动；回滚只还原前台可见的那部分。
 * 依赖种子里的上海 / 静安区 / 平台默认商户（scripts/seed.ts）。图片列表留空，不发网络请求。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

// 每次跑用不同的 externalId，避免与上一次失败遗留的数据撞局部唯一索引
const RUN = String(Date.now()).slice(-7)
const B_EXT = `9${RUN}`
const L1 = `8${RUN}`
const L2 = `7${RUN}`

const buildingRow = (over: Partial<HuizuBuildingRow> = {}): HuizuBuildingRow => ({
  kind: 'building',
  externalId: B_EXT,
  sourceUrl: `https://www.huizuxuanzhi.com/loupan/l${B_EXT}`,
  slug: `opt104-test-building-${B_EXT}`,
  attachToBuildingId: null,
  name: `OPT104测试楼盘${RUN}`,
  districtName: '静安区',
  businessAreaName: null,
  address: '测试路1号',
  latitude: 31.23,
  longitude: 121.45,
  completionYear: 2010,
  totalFloors: 30,
  grossFloorArea: 50000,
  standardFloorHeight: 4,
  netCeilingHeight: 2.8,
  passengerElevators: 8,
  elevatorNote: '客梯8部',
  airConditioning: '中央空调',
  network: '电信',
  propertyFee: 30,
  parkingSpaces: 200,
  parkingFee: '800元/月',
  developer: '测试开发商',
  propertyCompany: '测试物业',
  description: '测试简介',
  images: [],
  ...over,
})

const listingRow = (externalId: string, over: Partial<HuizuListingRow> = {}): HuizuListingRow => ({
  kind: 'listing',
  externalId,
  buildingExternalId: B_EXT,
  sourceUrl: `https://www.huizuxuanzhi.com/loupan/l${B_EXT}-x${externalId}.html`,
  slug: `opt104-test-listing-huizu-${externalId}`,
  title: `OPT104测试楼盘${RUN} 200㎡ 精装修`,
  area: 200,
  dailyRent: 4.5,
  decorationStatus: 'furnished',
  decorationRaw: '精装修',
  registrable: true,
  floor: '中层',
  orientation: '朝南',
  efficiencyRate: 70,
  seatMin: 20,
  seatMax: 40,
  isDivisible: false,
  paymentTerms: '押3付1',
  depositMonths: 3,
  minimumLeaseMonths: 24,
  propertyFee: null,
  description: '测试房源描述',
  ...over,
})

describe.skipIf(!databaseAvailable)('OPT-104 外部来源同步任务', () => {
  let payload: Payload
  const batchIds: number[] = []
  let buildingId: number
  let listing1Id: number
  let listing2Id: number

  async function runBatch(kind: 'buildings' | 'listings' | 'retire', rows: HuizuSyncRow[]) {
    const batch = await payload.create({
      collection: 'source-sync-batches',
      data: {
        source: 'huizuxuanzhi',
        kind,
        status: 'queued',
        fileName: `test-${kind}`,
        rowCount: rows.length,
        rows: rows as unknown as Record<string, unknown>[],
        cursor: 0,
      },
      overrideAccess: true,
    })
    batchIds.push(batch.id as number)
    for (let i = 0; i < 20; i++) {
      const { hasMore } = await runSourceSyncSlice(payload, undefined, batch.id as number)
      if (!hasMore) break
    }
    return (await payload.findByID({
      collection: 'source-sync-batches',
      id: batch.id,
      overrideAccess: true,
    })) as unknown as {
      id: number
      status: string
      stats: Record<string, number>
      affected: Record<string, unknown>
      writeErrors: { message: string }[] | null
    }
  }

  async function findBySource(collection: 'buildings' | 'listings', externalId: string) {
    const res = await payload.find({
      collection,
      where: { 'dataSource.source': { equals: 'huizuxuanzhi' }, 'dataSource.externalId': { equals: externalId } },
      trash: true,
      depth: 0,
      overrideAccess: true,
    })
    return res.docs[0] as unknown as Record<string, unknown>
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    // 测试库清场（生产代码里永不删除；这里是测试自己造的数据）
    for (const id of [listing1Id, listing2Id].filter(Boolean)) {
      await payload.delete({ collection: 'listings', id, overrideAccess: true }).catch(() => undefined)
    }
    if (buildingId)
      await payload.delete({ collection: 'buildings', id: buildingId, overrideAccess: true }).catch(() => undefined)
    for (const id of batchIds) {
      await payload.db.pool.query('DELETE FROM source_sync_batches WHERE id = $1', [id]).catch(() => undefined)
    }
  })

  it('楼盘包：新建为草稿，带来源与采集字段', async () => {
    const batch = await runBatch('buildings', [buildingRow()])
    expect(batch.writeErrors ?? []).toEqual([])
    expect(batch).toMatchObject({ status: 'completed', stats: { created: 1, failed: 0 } })
    const b = await findBySource('buildings', B_EXT)
    buildingId = b.id as number
    expect(b).toMatchObject({
      status: 'draft',
      operationalStatus: 'active',
      slug: `opt104-test-building-${B_EXT}`,
      totalFloors: 30,
      dataSource: { source: 'huizuxuanzhi', externalId: B_EXT },
    })
  })

  it('楼盘再同步只填空：运营改过的字段不被覆盖，清空的字段被补上', async () => {
    await payload.update({
      collection: 'buildings',
      id: buildingId,
      data: { address: '运营精修地址', totalFloors: null },
      overrideAccess: true,
    })
    const batch = await runBatch('buildings', [buildingRow({ address: '采集地址', totalFloors: 31 })])
    expect(batch.stats).toMatchObject({ updated: 1, created: 0 })
    const b = await findBySource('buildings', B_EXT)
    expect(b.address).toBe('运营精修地址')
    expect(b.totalFloors).toBe(31)
  })

  it('房源包：新建为草稿 / 未提交，挂平台默认商户', async () => {
    const batch = await runBatch('listings', [listingRow(L1), listingRow(L2)])
    expect(batch.writeErrors ?? []).toEqual([])
    expect(batch.stats).toMatchObject({ created: 2, failed: 0 })
    const l1 = await findBySource('listings', L1)
    listing1Id = l1.id as number
    listing2Id = (await findBySource('listings', L2)).id as number
    expect(l1).toMatchObject({
      publicationStatus: 'draft',
      reviewStatus: 'not_submitted',
      supplyVisibilityHold: 'normal',
      building: buildingId,
      floor: '中层',
      price: { amount: 4.5, period: 'day', unit: 'sqm' },
    })
    expect(l1.merchant).toBeTruthy()
  })

  it('已上架房源被覆盖时记下原值；状态与商户不动', async () => {
    await payload.update({
      collection: 'listings',
      id: listing1Id,
      data: { publicationStatus: 'published', reviewStatus: 'approved' },
      overrideAccess: true,
    })
    const batch = await runBatch('listings', [listingRow(L1, { dailyRent: 5.2 }), listingRow(L2)])
    expect(batch.stats).toMatchObject({ updated: 1, unchanged: 1 })
    const l1 = await findBySource('listings', L1)
    expect(l1).toMatchObject({ publicationStatus: 'published', reviewStatus: 'approved', rent: 5.2 })
    expect(batch.affected.updatedPublishedListings).toEqual([
      { id: listing1Id, before: { rent: 4.5, 'price.amount': 4.5 } },
    ])
  })

  it('下架包：只下架已上架的；草稿与已租的不动', async () => {
    await payload.update({
      collection: 'listings',
      id: listing2Id,
      data: { publicationStatus: 'leased' },
      overrideAccess: true,
    })
    const batch = await runBatch('retire', [
      { kind: 'retire', externalId: L1, reason: 'gone' },
      { kind: 'retire', externalId: L2, reason: 'gone' },
      { kind: 'retire', externalId: '1', reason: 'not-enumerated' },
    ])
    expect(batch.stats).toMatchObject({ retired: 1, skipped: 2 })
    expect((await findBySource('listings', L1)).publicationStatus).toBe('unpublished')
    expect((await findBySource('listings', L2)).publicationStatus).toBe('leased')
  })

  it('回滚：恢复上架、还原被覆盖的字段；不能回滚两次', async () => {
    const retireBatch = batchIds[batchIds.length - 1]
    const updateBatch = batchIds[batchIds.length - 2]
    const r1 = await rollbackSourceSyncBatch(payload, undefined, retireBatch)
    expect(r1).toMatchObject({ ok: true, republished: 1, restored: 0 })
    const r2 = await rollbackSourceSyncBatch(payload, undefined, updateBatch)
    expect(r2).toMatchObject({ ok: true, restored: 1 })
    const l1 = await findBySource('listings', L1)
    expect(l1).toMatchObject({ publicationStatus: 'published', rent: 4.5, price: { amount: 4.5 } })
    expect(await rollbackSourceSyncBatch(payload, undefined, retireBatch)).toMatchObject({ ok: false, status: 409 })
  })

  it('房源包里的楼盘没同步过：该行失败，其它行照常', async () => {
    // 楼盘 id 用本次运行独有的值：本地库可能已灌过全量演练数据（对方楼盘 1 等真实存在）
    const batch = await runBatch('listings', [listingRow(`6${RUN}`, { buildingExternalId: `5${RUN}5` })])
    expect(batch.stats).toMatchObject({ failed: 1, created: 0 })
    expect(batch.writeErrors?.[0]?.message).toContain('尚未同步')
  })
  it('房源包排在楼盘包之后：有排队或近期推进的楼盘批次时等待，链条断了的不挡', async () => {
    const mk = async (kind: 'buildings' | 'listings', status: string) => {
      const b = await payload.create({
        collection: 'source-sync-batches',
        data: {
          source: 'huizuxuanzhi',
          kind,
          status,
          fileName: `wait-${kind}`,
          rowCount: 0,
          rows: [],
          cursor: 0,
        } as never,
        overrideAccess: true,
      })
      batchIds.push(b.id as number)
      return b.id as number
    }
    // 先把库里其它楼盘批次的影响排除：本用例只看自己造的两条
    const others = await payload.db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM source_sync_batches WHERE kind = 'buildings' AND status IN ('queued','running')`,
    )
    if ((others.rows[0]?.n ?? 0) > 0) return // 本地库正有楼盘批次在跑时跳过，避免假失败
    const listingBatch = await mk('listings', 'queued')
    expect(await shouldWaitForBuildings(payload, listingBatch)).toBe(false)
    const buildingBatch = await mk('buildings', 'queued')
    expect(await shouldWaitForBuildings(payload, listingBatch)).toBe(true)
    expect(await shouldWaitForBuildings(payload, buildingBatch)).toBe(false) // 楼盘包自己不等
    await payload.db.pool.query(
      `UPDATE source_sync_batches SET status = 'running', updated_at = now() - interval '45 minutes' WHERE id = $1`,
      [buildingBatch],
    )
    expect(await shouldWaitForBuildings(payload, listingBatch)).toBe(false) // 半小时没推进视为链条已断
    await payload.db.pool.query(`UPDATE source_sync_batches SET updated_at = now() WHERE id = $1`, [buildingBatch])
    expect(await shouldWaitForBuildings(payload, listingBatch)).toBe(true)
    await payload.db.pool.query(`UPDATE source_sync_batches SET status = 'completed' WHERE id = $1`, [buildingBatch])
    expect(await shouldWaitForBuildings(payload, listingBatch)).toBe(false)
  })
  it('挂靠手工楼盘：补上来源、只填空；已有封面的不拉图、不换封面', async () => {
    const buffer = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg({ quality: 60 })
      .toBuffer()
    const media = await payload.create({
      collection: 'media',
      data: { alt: `opt104-manual-cover-${RUN}`, usage: 'other' },
      file: { data: buffer, mimetype: 'image/jpeg', name: `opt104-manual-${RUN}.jpg`, size: buffer.length },
      overrideAccess: true,
    })
    const district = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'district' }, name: { equals: '静安区' } },
      depth: 1,
      limit: 1,
      overrideAccess: true,
    })
    const d = district.docs[0] as unknown as { id: number; parent: { id: number } | number }
    const cityId = typeof d.parent === 'object' ? d.parent.id : d.parent
    const manual = await payload.create({
      collection: 'buildings',
      data: {
        name: `OPT104手工楼盘${RUN}`,
        slug: `opt104-manual-${RUN}`,
        city: cityId,
        district: d.id,
        status: 'published',
        address: '运营填的地址',
        coverImage: media.id,
      } as never,
      overrideAccess: true,
      depth: 0,
    })
    const ext = `4${RUN}4`
    try {
      const batch = await runBatch('buildings', [
        buildingRow({
          externalId: ext,
          sourceUrl: `https://www.huizuxuanzhi.com/loupan/l${ext}`,
          slug: `opt104-attach-${ext}`,
          attachToBuildingId: manual.id as number,
          name: '对方的楼盘名',
          address: '对方的地址',
          images: ['https://huizutec.oss-cn-shanghai.aliyuncs.com/uploads/images/building/1/never-fetched.jpg'],
        }),
      ])
      expect(batch.writeErrors ?? []).toEqual([])
      expect(batch.stats).toMatchObject({ updated: 1, created: 0, imagesCreated: 0 })
      const b = (await payload.findByID({
        collection: 'buildings',
        id: manual.id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as Record<string, unknown>
      expect(b).toMatchObject({
        name: `OPT104手工楼盘${RUN}`,
        address: '运营填的地址',
        coverImage: media.id,
        totalFloors: 30,
        dataSource: { source: 'huizuxuanzhi', externalId: ext },
      })
      expect(b.mediaItems ?? []).toEqual([])
    } finally {
      await payload.delete({ collection: 'buildings', id: manual.id, overrideAccess: true }).catch(() => undefined)
      await payload.delete({ collection: 'media', id: media.id, overrideAccess: true }).catch(() => undefined)
    }
  })
})
