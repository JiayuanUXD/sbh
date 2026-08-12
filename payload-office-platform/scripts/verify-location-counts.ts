/**
 * Task 5 聚合计数服务 · 真实库集成验证
 *
 * 在本地库（sbh_dev_geo）造 2 城数据，调用四个计数函数，
 * 与手工推导的期望值比对。可重复执行（楼盘按 slug upsert）。
 *
 * 运行：pnpm verify:location-counts
 */
import { getPayload } from 'payload'

import config from '../src/payload.config'
import {
  countForBusinessAreas,
  countForCities,
  countForDistricts,
  countForMetroLines,
} from '../src/domain/geography/location-counts'

type Node = { id: number; name: string }

async function findByName(payload: Awaited<ReturnType<typeof getPayload>>, name: string): Promise<Node> {
  const res = await payload.find({
    collection: 'locations',
    where: { name: { equals: name } },
    limit: 1,
    depth: 0,
  })
  const doc = res.docs[0] as unknown as { id: number }
  if (!doc) throw new Error(`找不到节点: ${name}`)
  return { id: doc.id, name }
}

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  const log: string[] = []
  const fail: string[] = []
  const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    log.push(`${ok ? 'PASS' : 'FAIL'}  ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
    if (!ok) fail.push(label)
  }

  // —— 定位 2 城样板节点（由 Task 4 回填迁移保证 city_id 正确）——
  const hangzhou = await findByName(payload, '杭州')
  const suzhou = await findByName(payload, '苏州')
  const xihu = await findByName(payload, '西湖区')
  const qianjiang = await findByName(payload, '钱江新城')
  const lineH = await findByName(payload, '1号线')
  const stationH = await findByName(payload, '龙翔桥站')
  const gusu = await findByName(payload, '姑苏区')
  const jinji = await findByName(payload, '金鸡湖')
  const lineS = await findByName(payload, '2号线')

  // —— 楼盘 fixtures（按 slug upsert，幂等）——
  async function upsertBuilding(args: {
    slug: string
    name: string
    cityId: number
    districtId: number
    businessDistrictId?: number
    status: 'draft' | 'published' | 'archived'
  }): Promise<{ id: number }> {
    const existing = await payload.find({
      collection: 'buildings',
      where: { slug: { equals: args.slug } },
      limit: 1,
      depth: 0,
    })
    const data: {
      name: string
      slug: string
      city: number
      district: number
      businessDistrict?: number
      status: 'draft' | 'published' | 'archived'
      operationalStatus: 'active' | 'disabled'
    } = {
      name: args.name,
      slug: args.slug,
      city: args.cityId,
      district: args.districtId,
      businessDistrict: args.businessDistrictId,
      status: args.status,
      operationalStatus: 'active',
    }
    if (existing.docs[0]) {
      await payload.update({ collection: 'buildings', id: existing.docs[0].id, data })
      return { id: existing.docs[0].id }
    }
    const created = await payload.create({ collection: 'buildings', data })
    return { id: created.id }
  }

  const pubHang = await upsertBuilding({
    slug: 'verify-count-hang-public',
    name: '验证楼盘-杭州-发布',
    cityId: hangzhou.id,
    districtId: xihu.id,
    businessDistrictId: qianjiang.id,
    status: 'published',
  })
  const delHang = await upsertBuilding({
    slug: 'verify-count-hang-deleted',
    name: '验证楼盘-杭州-已删',
    cityId: hangzhou.id,
    districtId: xihu.id,
    businessDistrictId: qianjiang.id,
    status: 'published',
  })
  const pubSu = await upsertBuilding({
    slug: 'verify-count-su-public',
    name: '验证楼盘-苏州-发布',
    cityId: suzhou.id,
    districtId: gusu.id,
    businessDistrictId: jinji.id,
    status: 'published',
  })
  const draftSu = await upsertBuilding({
    slug: 'verify-count-su-draft',
    name: '验证楼盘-苏州-草稿',
    cityId: suzhou.id,
    districtId: gusu.id,
    businessDistrictId: jinji.id,
    status: 'draft',
  })
  // 已删楼盘：trash 置 deleted_at
  await payload.delete({ collection: 'buildings', id: delHang.id })

  // —— 商圈扩展 fixture：杭州钱江新城带边界并关联站点；苏州金鸡湖无扩展 ——
  const extRes = await payload.find({
    collection: 'business-area-extensions',
    where: { businessArea: { equals: qianjiang.id } },
    limit: 1,
    depth: 0,
  })
  if (!extRes.docs[0]) {
    await payload.create({
      collection: 'business-area-extensions',
      data: {
        businessArea: qianjiang.id,
        boundary: {
          type: 'Polygon',
          coordinates: [
            [
              [120.1, 30.2],
              [120.2, 30.2],
              [120.2, 30.3],
              [120.1, 30.3],
              [120.1, 30.2],
            ],
          ],
        },
        metroStations: [stationH.id],
      },
    })
  }

  // —— 调用 + 比对 ——
  const cityH = (await countForCities(payload, [hangzhou.id])).get(hangzhou.id)
  const cityS = (await countForCities(payload, [suzhou.id])).get(suzhou.id)
  check('城市-杭州计数', cityH, {
    districts: 1,
    businessAreas: 1,
    businessAreasMissingBoundary: 0,
    metroLines: 1,
    metroStations: 1,
    buildings: 1,
  })
  check('城市-苏州计数', cityS, {
    districts: 1,
    businessAreas: 1,
    businessAreasMissingBoundary: 1,
    metroLines: 1,
    metroStations: 1,
    buildings: 1,
  })

  const both = await countForCities(payload, [hangzhou.id, suzhou.id])
  check('多城一次聚合返回两城', [both.size, both.get(suzhou.id)?.buildings], [2, 1])

  const distH = (await countForDistricts(payload, [xihu.id])).get(xihu.id)
  const distS = (await countForDistricts(payload, [gusu.id])).get(gusu.id)
  check('行政区-杭州西湖', distH, { businessAreas: 1, buildings: 1 })
  check('行政区-苏州姑苏', distS, { businessAreas: 1, buildings: 1 })

  const areaH = (await countForBusinessAreas(payload, [qianjiang.id])).get(qianjiang.id)
  const areaS = (await countForBusinessAreas(payload, [jinji.id])).get(jinji.id)
  check('商圈-杭州钱江(带扩展)', areaH, { buildings: 1, stations: 1, metroLines: 1 })
  check('商圈-苏州金鸡(无扩展)', areaS, { buildings: 1, stations: 0, metroLines: 0 })

  const lineHc = (await countForMetroLines(payload, [lineH.id])).get(lineH.id)
  const lineSc = (await countForMetroLines(payload, [lineS.id])).get(lineS.id)
  check('地铁线路-杭州1号线', lineHc, { stations: 1 })
  check('地铁线路-苏州2号线', lineSc, { stations: 1 })

  console.log(log.join('\n'))
  console.log(fail.length === 0 ? '\n全部通过 ✅' : `\n${fail.length} 项 FAIL: ${fail.join(', ')}`)
  process.exit(fail.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})