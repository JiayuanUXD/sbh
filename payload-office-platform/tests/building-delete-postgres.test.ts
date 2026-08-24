import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'

/**
 * 楼盘删除的真库集成测试（OPT-050）。
 *
 * ## 为什么必须有真库这一层
 *
 * 单测（`building-delete-cleanup.test.ts`）用 mock 验的是**守卫的判断逻辑**，
 * 但本工作项的病根在**数据库约束**：`ON DELETE SET NULL` 撞 `NOT NULL`。
 * mock 永远碰不到那个死结——守卫哪怕写错了，单测照样全绿，而生产照样 500。
 *
 * 这条测试走真实 PG，验的是三件事：
 *   1. 有房源时被拦，且**楼盘还在**（不是拦了但已经删了一半）；
 *   2. 按提示删掉房源后，楼盘**真的能删成功**——这一步才真正穿过那个外键死结；
 *   3. 楼盘的 `building-merchant-relations` 被一并清掉，不留垃圾行。
 *
 * 第 2 条是关键：如果守卫只是「拦住」而没解决死结，这一步会以 500 失败。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('OPT-050 楼盘删除', () => {
  let payload: Payload
  let cityId: number | string
  let districtId: number | string
  const createdBuildings: Array<number | string> = []
  const createdListings: Array<number | string> = []
  const createdMerchants: Array<number | string> = []

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
  })

  afterAll(async () => {
    for (const id of createdListings) {
      await payload
        .delete({ collection: 'listings', id, overrideAccess: true, trash: true })
        .catch(() => null)
    }
    for (const id of createdBuildings) {
      await payload.delete({ collection: 'buildings', id, overrideAccess: true }).catch(() => null)
    }
    for (const id of createdMerchants) {
      await payload.delete({ collection: 'merchants', id, overrideAccess: true }).catch(() => null)
    }
  })

  async function makeBuilding(tag: string) {
    const b = await payload.create({
      collection: 'buildings',
      data: {
        name: `OPT050-${tag}-${Date.now()}`,
        slug: `opt050-${tag}-${Date.now()}`,
        city: Number(cityId),
        district: Number(districtId),
        status: 'published',
        operationalStatus: 'active',
      },
      overrideAccess: true,
    })
    createdBuildings.push(b.id)
    return b
  }

  it('没有房源的楼盘可以正常删除', async () => {
    const b = await makeBuilding('empty')
    await expect(
      payload.delete({ collection: 'buildings', id: b.id, overrideAccess: true }),
    ).resolves.toBeTruthy()
  })

  it('楼盘的商户关系会被一并清掉，不留垃圾行', async () => {
    const b = await makeBuilding('withrel')
    const m = await payload.create({
      collection: 'merchants',
      data: {
        name: `OPT050-测试商户-${Date.now()}`,
        type: 'AGENCY',
        status: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: '2099-01-01T00:00:00.000Z',
        serviceCities: [Number(cityId)],
      },
      overrideAccess: true,
    })
    createdMerchants.push(m.id)
    await payload.create({
      collection: 'building-merchant-relations',
      data: {
        building: Number(b.id),
        merchant: Number(m.id),
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      },
      overrideAccess: true,
    })

    await payload.delete({ collection: 'buildings', id: b.id, overrideAccess: true })

    const left = await payload.count({
      collection: 'building-merchant-relations',
      where: { building: { equals: b.id } },
      overrideAccess: true,
    })
    expect(left.totalDocs).toBe(0)
  })

  it('有房源时被拦，且楼盘仍在；删掉房源后能真正删成功', async () => {
    const b = await makeBuilding('withlisting')
    const merchant = await payload.create({
      collection: 'merchants',
      data: {
        name: `OPT050-房源商户-${Date.now()}`,
        type: 'AGENCY',
        status: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: '2099-01-01T00:00:00.000Z',
        serviceCities: [Number(cityId)],
      },
      overrideAccess: true,
    })
    createdMerchants.push(merchant.id)

    const listing = await payload.create({
      collection: 'listings',
      data: {
        title: `OPT050-测试房源-${Date.now()}`,
        slug: `opt050-listing-${Date.now()}`,
        listingType: 'traditional-office',
        building: Number(b.id),
        merchant: Number(merchant.id),
        area: 100,
        price: { amount: 5, currency: 'CNY', period: 'day', unit: 'sqm' },
      },
      overrideAccess: true,
    })
    createdListings.push(listing.id)

    // ① 被拦，且文案可操作
    await expect(
      payload.delete({ collection: 'buildings', id: b.id, overrideAccess: true }),
    ).rejects.toThrow(/还有 1 套房源/)

    // ② 拦下之后楼盘必须还在——不能拦了却已经删了一半
    const still = await payload.findByID({
      collection: 'buildings',
      id: b.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(still.id).toBe(b.id)

    // ③ 按提示删掉房源后，楼盘真的能删成功
    //    这一步才真正穿过 `SET NULL + NOT NULL` 那个死结——守卫只要没解决它，
    //    这里就会以 500 失败。
    await payload.delete({ collection: 'listings', id: listing.id, overrideAccess: true, trash: false })
    await expect(
      payload.delete({ collection: 'buildings', id: b.id, overrideAccess: true }),
    ).resolves.toBeTruthy()
  })
})
