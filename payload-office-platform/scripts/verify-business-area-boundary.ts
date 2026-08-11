/**
 * Task 9 商圈边界状态 · 真实库集成验证
 *
 * 在本地库（sbh_dev_geo）调新增的两个边界函数，与手工推导的期望值比对：
 *  - fetchBusinessAreaBoundaryStatus：本页商圈「是否有非空边界」
 *  - fetchBusinessAreaMissingBoundaryIds：「缺边界」商圈 id 集合（口径与 Task 5 一致）
 *
 * 复用 Task 5 verify-location-counts 的样板：杭州钱江新城有边界扩展、苏州金鸡湖无扩展。
 * 运行：pnpm verify:business-area-boundary
 */
import { getPayload } from 'payload'

import config from '../src/payload.config'
import {
  countForCities,
  fetchBusinessAreaBoundaryStatus,
  fetchBusinessAreaMissingBoundaryIds,
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

  const qianjiang = await findByName(payload, '钱江新城') // 杭州 · 有扩展 + 非空边界
  const jinji = await findByName(payload, '金鸡湖') // 苏州 · 无扩展 → 缺边界
  const hangzhou = await findByName(payload, '杭州')
  const suzhou = await findByName(payload, '苏州')

  // —— 边界状态（列数据）——
  const status = await fetchBusinessAreaBoundaryStatus(payload, [qianjiang.id, jinji.id])
  check('边界状态-钱江(有扩展) 有边界', status.get(qianjiang.id), true)
  check('边界状态-金鸡(无扩展) 缺边界', status.get(jinji.id), false)
  check('边界状态-请求缺失 id 返回缺省 false', (await fetchBusinessAreaBoundaryStatus(payload, [1])).get(1), false)
  check('边界状态-空 ids 返回空 Map', (await fetchBusinessAreaBoundaryStatus(payload, [])).size, 0)

  // —— 缺边界 id 集合（快捷 chip 过滤）——
  const missing = await fetchBusinessAreaMissingBoundaryIds(payload)
  const missingSet = new Set(missing)
  check('缺边界集合-金鸡在集合内', missingSet.has(jinji.id), true)
  check('缺边界集合-钱江不在集合内', missingSet.has(qianjiang.id), false)

  // —— 与 Task 5 每城 missing_boundary 口径交叉核对 ——
  // 缺边界集合按城收窄后的条数，应等于 countForCities 对应城的 businessAreasMissingBoundary。
  async function missingInCity(cityId: number): Promise<number> {
    const res = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'business_area' }, city: { equals: cityId } },
      limit: 1000,
      depth: 0,
    })
    return (res.docs as Array<{ id: number }>).filter((d) => missingSet.has(d.id)).length
  }
  const cityCounts = await countForCities(payload, [hangzhou.id, suzhou.id])
  check(
    '交叉-杭州缺边界数 集合按城过滤 vs Task5',
    await missingInCity(hangzhou.id),
    cityCounts.get(hangzhou.id)?.businessAreasMissingBoundary,
  )
  check(
    '交叉-苏州缺边界数 集合按城过滤 vs Task5',
    await missingInCity(suzhou.id),
    cityCounts.get(suzhou.id)?.businessAreasMissingBoundary,
  )

  console.log(log.join('\n'))
  console.log(fail.length === 0 ? '\n全部通过 ✅' : `\n${fail.length} 项 FAIL: ${fail.join(', ')}`)
  process.exit(fail.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})