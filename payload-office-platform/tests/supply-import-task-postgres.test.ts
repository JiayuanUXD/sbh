import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import config from '@/payload.config'
import {
  SUPPLY_IMPORT_QUEUE,
  SUPPLY_IMPORT_TASK,
  runSupplyImportBatch,
} from '@/domain/supply-import/import-task'

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('OPT-041 导入写入层', () => {
  let payload: Payload
  let buildingId: number | string
  let cityId: number | string
  let districtId: number | string
  let merchantId: number | string
  const createdListingIds: Array<number | string> = []
  const createdBuildingIds: Array<number | string> = []
  const createdBatchIds: Array<number | string> = []
  const createdMerchantIds: Array<number | string> = []
  const createdRelationIds: Array<number | string> = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    const city = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'city' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    cityId = city.docs[0].id

    const district = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'district' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    districtId = district.docs[0].id

    // D10 测试夹具：专用楼盘（而不是随便挑数据库里已存在的第一栋楼）+ 专用商户 +
    // 当前生效关系。用专属楼盘而不是共享的"第一栋楼"，是因为本文件与
    // supply-import-rollback-postgres.test.ts 可能被 vitest 并行调度到同一个真库，
    // 两边若都往同一栋"第一栋楼"上挂 [2020-01-01, ∞) 的商户关系，会撞
    // RELATION_OVERLAP——各自建一栋专属楼盘彻底消除这个交叉污染。
    const testBuilding = await payload.create({
      collection: 'buildings',
      data: {
        name: `OPT-041-D10-测试楼盘-${Date.now()}`,
        slug: `opt-041-d10-test-building-${Date.now()}`,
        city: Number(cityId),
        district: Number(districtId),
        status: 'published',
        operationalStatus: 'active',
      },
      overrideAccess: true,
    })
    buildingId = testBuilding.id
    createdBuildingIds.push(buildingId)

    const merchant = await payload.create({
      collection: 'merchants',
      data: {
        name: `OPT-041-D10-测试商户-${Date.now()}`,
        type: 'AGENCY',
        status: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: '2099-01-01T00:00:00.000Z',
        serviceCities: [Number(cityId)],
      },
      overrideAccess: true,
    })
    merchantId = merchant.id
    createdMerchantIds.push(merchant.id)

    const relation = await payload.create({
      collection: 'building-merchant-relations',
      data: {
        building: Number(buildingId),
        merchant: Number(merchantId),
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
      overrideAccess: true,
    })
    createdRelationIds.push(relation.id)
  })

  afterAll(async () => {
    for (const id of createdListingIds) {
      await payload.delete({ collection: 'listings', id, overrideAccess: true }).catch(() => null)
    }
    for (const id of createdBuildingIds) {
      await payload.delete({ collection: 'buildings', id, overrideAccess: true }).catch(() => null)
    }
    for (const id of createdBatchIds) {
      await payload.delete({ collection: 'supply-import-batches', id, overrideAccess: true }).catch(() => null)
    }
    for (const id of createdRelationIds) {
      await payload.delete({ collection: 'building-merchant-relations', id, overrideAccess: true }).catch(() => null)
    }
    for (const id of createdMerchantIds) {
      await payload.delete({ collection: 'merchants', id, overrideAccess: true }).catch(() => null)
    }
  })

  function rows(externalId: string) {
    return [
      {
        externalId,
        title: `导入测试 ${externalId}`,
        // brief 原文示例是 'office'，但 LISTING_TYPES（domain/review/listing-fields.ts）
        // 没有这个取值——ValidListingRow.listingType 只会是四个真实枚举之一（Task 4 从
        // 中文标签映射而来），brief 里的 'office' 无法从真实校验层产出，改用真实取值，
        // 否则本用例期望的 created:1 会被 Listings 的 select 字段校验真实拒绝成 failed:1。
        listingType: 'traditional-office',
        buildingId,
        cityId,
        area: 280,
        rentAmount: 4.5,
        rentUnit: 'rmb-sqm-day',
        floor: 12,
        decorationStatus: null,
        availableFrom: null,
      },
    ]
  }

  function buildingRows(externalId: string) {
    return [
      {
        externalId,
        name: `导入测试楼盘 ${externalId}`,
        cityId,
        districtId,
        businessAreaId: null,
        address: null,
        totalFloors: null,
        grossFloorArea: null,
      },
    ]
  }

  it('第一次跑全部新建，第二次跑全部更新——重传不翻倍', async () => {
    const first = await runSupplyImportBatch({ payload, type: 'listings', validRows: rows('E2E-IDEMP-1') })
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 0 })
    createdListingIds.push(...first.affectedIds)

    const second = await runSupplyImportBatch({ payload, type: 'listings', validRows: rows('E2E-IDEMP-1') })
    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 })
    expect(second.affectedIds).toEqual(first.affectedIds)
  })

  it('导入的房源直接上架（规格 D4），且带 manual-import 溯源', async () => {
    const doc = await payload.findByID({
      collection: 'listings',
      id: createdListingIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(doc.publicationStatus).toBe('published')
    expect(doc.reviewStatus).toBe('approved')
    expect(doc.dataSource?.source).toBe('manual-import')
    expect(doc.dataSource?.externalId).toBe('E2E-IDEMP-1')
  })

  it('D10：房源写入独立解析楼盘当前生效商户，listings.merchant 落库为该商户 id（有效供给 §8 的唯一来源）', async () => {
    const doc = await payload.findByID({
      collection: 'listings',
      id: createdListingIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(String(doc.merchant)).toBe(String(merchantId))
  })

  it('D10 兜底守卫：楼盘没有生效商户关系时，房源行写入失败（failed），不阻断同批其它行', async () => {
    const orphanBuilding = await payload.create({
      collection: 'buildings',
      data: {
        name: `D10-无商户楼盘-${Date.now()}`,
        slug: `d10-no-merchant-building-${Date.now()}`,
        city: Number(cityId),
        district: Number(districtId),
        status: 'published',
        operationalStatus: 'active',
      },
      overrideAccess: true,
    })
    createdBuildingIds.push(orphanBuilding.id)

    const badRow = { ...rows('E2E-D10-NOMERCHANT')[0], buildingId: orphanBuilding.id }
    const result = await runSupplyImportBatch({ payload, type: 'listings', validRows: [badRow] })
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 1 })
    expect(result.errors[0]).toMatchObject({ externalId: 'E2E-D10-NOMERCHANT' })
    expect(result.errors[0].message).toContain('没有生效的供给商户')
  })

  it('更新时不改 slug——改 slug 会断掉已有前台 URL', async () => {
    const before = await payload.findByID({
      collection: 'listings',
      id: createdListingIds[0],
      depth: 0,
      overrideAccess: true,
    })
    await runSupplyImportBatch({
      payload,
      type: 'listings',
      validRows: [{ ...rows('E2E-IDEMP-1')[0], title: '改了标题' }],
    })
    const after = await payload.findByID({
      collection: 'listings',
      id: createdListingIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(after.slug).toBe(before.slug)
    expect(after.title).toBe('改了标题')
  })

  it('单行失败不阻断后续行，也不回滚已成功的行', async () => {
    const result = await runSupplyImportBatch({
      payload,
      type: 'listings',
      validRows: [
        { ...rows('E2E-BAD')[0], buildingId: 99999999 },
        rows('E2E-GOOD-1')[0],
      ],
    })
    expect(result.failed).toBe(1)
    expect(result.created).toBe(1)
    createdListingIds.push(...result.affectedIds)
  })

  it('局部唯一索引真的拦得住绕过应用层的重复写入', async () => {
    // 直接用 Local API 造第二条同 (source, externalId) 的房源，绕开 runSupplyImportBatch 的查重
    await expect(
      payload.create({
        collection: 'listings',
        data: {
          title: '越过应用层的重复',
          listingType: 'traditional-office',
          building: Number(buildingId),
          slug: 'dup-index-probe-opt041',
          reviewStatus: 'approved',
          publicationStatus: 'published',
          dataSource: { source: 'manual-import', externalId: 'E2E-IDEMP-1' },
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
    // 拦住了就说明 Task 1 的局部唯一索引真的建上了，而不是只靠应用层自觉
  })

  it('ADM 与 OPS 两种操作者导出的落地状态一致', async () => {
    // 落地状态由 runSupplyImportBatch 显式写死，不受 adminAutoPublish 的操作者身份影响
    const opsRole = await payload.find({
      collection: 'roles',
      where: { code: { equals: 'OPS' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const opsRoleId = opsRole.docs[0]?.id ?? null
    const opsUserResult = opsRoleId
      ? await payload.find({
          collection: 'users',
          where: { and: [{ status: { equals: 'active' } }, { roles: { in: [opsRoleId] } }] },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
      : { docs: [] }
    const opsUser = opsUserResult.docs[0]

    if (!opsUser) {
      // 种子数据里没有可用的 OPS 用户——不伪造一个假 user 对象糊弄过去，跳过并在用例名里说明。
      console.warn('[skip] 未找到 OPS 角色用户，跳过 ADM/OPS 落地状态一致性断言')
      return
    }

    const opsReq: PayloadRequest = await createLocalReq({ user: opsUser }, payload)
    const asOps = await runSupplyImportBatch({
      payload,
      req: opsReq,
      type: 'listings',
      validRows: rows('E2E-ROLE-OPS'),
    })
    createdListingIds.push(...asOps.affectedIds)
    const doc = await payload.findByID({
      collection: 'listings',
      id: asOps.affectedIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(doc.publicationStatus).toBe('published')
    expect(doc.reviewStatus).toBe('approved')
  })

  it('楼盘写入路径：第一次新建，第二次更新——幂等 + 落地状态 + update 不改 slug（评审 Task 7 第 1 轮 Important 4）', async () => {
    const first = await runSupplyImportBatch({ payload, type: 'buildings', validRows: buildingRows('E2E-BLDG-1') })
    expect(first).toMatchObject({ created: 1, updated: 0, failed: 0 })
    createdBuildingIds.push(...first.affectedIds)

    const second = await runSupplyImportBatch({ payload, type: 'buildings', validRows: buildingRows('E2E-BLDG-1') })
    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 })
    expect(second.affectedIds).toEqual(first.affectedIds)

    const before = await payload.findByID({
      collection: 'buildings',
      id: first.affectedIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(before.status).toBe('published')
    expect(before.operationalStatus).toBe('active')
    expect(before.dataSource?.source).toBe('manual-import')
    expect(before.dataSource?.externalId).toBe('E2E-BLDG-1')

    await runSupplyImportBatch({
      payload,
      type: 'buildings',
      validRows: [{ ...buildingRows('E2E-BLDG-1')[0], name: '改了名字' }],
    })
    const after = await payload.findByID({
      collection: 'buildings',
      id: first.affectedIds[0],
      depth: 0,
      overrideAccess: true,
    })
    expect(after.slug).toBe(before.slug)
    expect(after.name).toBe('改了名字')
  })

  it('崩溃重跑不丢已持久化的 affectedIds——重跑时某行转失败也不能把它的锚点冲掉（评审 Task 7 第 1 轮 Critical 1）', async () => {
    const initialValidRows = [
      { rowNumber: 2, ...rows('E2E-CRASH-1')[0] },
      { rowNumber: 3, ...rows('E2E-CRASH-2')[0] },
    ]
    const batch = await payload.create({
      collection: 'supply-import-batches',
      data: {
        type: 'listings',
        status: 'queued',
        fileName: 'crash-recovery-probe.xlsx',
        rowCount: initialValidRows.length,
        validRows: initialValidRows,
        rowErrors: { errors: [], rawRows: [], rawRowNumbers: [] },
      },
      overrideAccess: true,
    })
    createdBatchIds.push(batch.id)

    await payload.jobs.queue({
      task: SUPPLY_IMPORT_TASK,
      queue: SUPPLY_IMPORT_QUEUE,
      input: { batchId: batch.id },
      overrideAccess: true,
    })
    await payload.jobs.run({ queue: SUPPLY_IMPORT_QUEUE, overrideAccess: true })

    const afterFirstRun = await payload.findByID({
      collection: 'supply-import-batches',
      id: batch.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(afterFirstRun.status).toBe('completed')
    expect(afterFirstRun.stats).toMatchObject({ created: 2, updated: 0, failed: 0 })
    const firstAffectedIds = Array.isArray(afterFirstRun.affectedIds) ? afterFirstRun.affectedIds : []
    expect(firstAffectedIds).toHaveLength(2)
    for (const id of firstAffectedIds) {
      if (typeof id === 'number' || typeof id === 'string') createdListingIds.push(id)
    }

    // 模拟"重跑时这一行的条件变了"（比如引用的楼盘在两次运行之间被删）：
    // 第二行这次会失败，但它在第一次运行里已经真实创建的房源依然存在，
    // 回滚锚点绝不能因为这次失败被冲掉。
    const brokenValidRows = initialValidRows.map((row, index) =>
      index === 1 ? { ...row, buildingId: 99999999 } : row,
    )
    await payload.update({
      collection: 'supply-import-batches',
      id: batch.id,
      data: { status: 'queued', validRows: brokenValidRows },
      overrideAccess: true,
    })

    await payload.jobs.queue({
      task: SUPPLY_IMPORT_TASK,
      queue: SUPPLY_IMPORT_QUEUE,
      input: { batchId: batch.id },
      overrideAccess: true,
    })
    await payload.jobs.run({ queue: SUPPLY_IMPORT_QUEUE, overrideAccess: true })

    const afterSecondRun = await payload.findByID({
      collection: 'supply-import-batches',
      id: batch.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(afterSecondRun.status).toBe('completed')
    // 这次跑：第一行幂等更新成功，第二行因为楼盘不存在而失败。
    expect(afterSecondRun.stats).toMatchObject({ created: 0, updated: 1, failed: 1 })
    const secondAffectedIds = Array.isArray(afterSecondRun.affectedIds) ? afterSecondRun.affectedIds : []
    // 核心断言：并集，不是第二次的子集——两个 id 都还在，第二行这次失败也没把它冲掉。
    expect(secondAffectedIds).toHaveLength(2)
    expect(new Set(secondAffectedIds.map(String))).toEqual(new Set(firstAffectedIds.map(String)))
  })

  it('写入失败的具体原因要能落库，不能只看到 stats.failed 的数字（评审 Task 7 第 1 轮 Important 2）', async () => {
    const validRows = [{ rowNumber: 2, ...rows('E2E-WRITEERR-1')[0], buildingId: 99999999 }]
    const preflightErrors = {
      errors: [
        {
          rowNumber: 5,
          column: '面积',
          rawValue: 'x',
          code: 'AREA_INVALID',
          message: '预检阶段的错误，不该被写入阶段覆盖',
        },
      ],
      rawRows: [],
      rawRowNumbers: [5],
    }
    const batch = await payload.create({
      collection: 'supply-import-batches',
      data: {
        type: 'listings',
        status: 'queued',
        fileName: 'write-error-probe.xlsx',
        rowCount: validRows.length,
        validRows,
        rowErrors: preflightErrors,
      },
      overrideAccess: true,
    })
    createdBatchIds.push(batch.id)

    await payload.jobs.queue({
      task: SUPPLY_IMPORT_TASK,
      queue: SUPPLY_IMPORT_QUEUE,
      input: { batchId: batch.id },
      overrideAccess: true,
    })
    await payload.jobs.run({ queue: SUPPLY_IMPORT_QUEUE, overrideAccess: true })

    const finalBatch = await payload.findByID({
      collection: 'supply-import-batches',
      id: batch.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(finalBatch.stats).toMatchObject({ failed: 1 })

    const rowErrorsValue = finalBatch.rowErrors
    const record =
      typeof rowErrorsValue === 'object' && rowErrorsValue !== null && !Array.isArray(rowErrorsValue)
        ? (rowErrorsValue as Record<string, unknown>)
        : {}
    // 写入错误落进新键 writeErrors，能定位是哪一行（externalId）、为什么。
    expect(JSON.stringify(record.writeErrors)).toContain('E2E-WRITEERR-1')
    // 预检阶段写的 errors 键必须原样保留，写入阶段绝不能把它覆盖掉——两者语义不同不能混。
    expect(record.errors).toEqual(preflightErrors.errors)
  })
})
