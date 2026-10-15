/**
 * OPT-114 本地验收夹具：一个楼盘 + 500 套「已上架 / 审核通过」房源。
 *
 * 只用于本地验收「每页 500 条 → 全选 → 取消 10 套 → 批量下架」这条路径，
 * 并测量列表加载耗时。**只写本地库**：入口先过 seed 目标守卫（DATABASE_URL 必须是环回地址、
 * COS 不得指向生产桶），任何一条不满足直接抛错退出。
 *
 * 用法（须在应用目录内运行，才能解析 payload 与 @/ 别名；同 OPT-112 的脚本惯例）：
 *   cp ../artifacts/verification/OPT-114/seed-500-listings.mts ./.opt114-seed.mts
 *   node --env-file-if-exists=.env.local --import tsx ./.opt114-seed.mts           # 建 / 补齐
 *   node --env-file-if-exists=.env.local --import tsx ./.opt114-seed.mts --reset   # 每轮验收前复位
 *   node --env-file-if-exists=.env.local --import tsx ./.opt114-seed.mts --trash   # 跑 E2E 前移进回收站
 *   rm ./.opt114-seed.mts
 *
 * 默认：楼盘不存在则建；已有的夹具房源全部恢复成「已上架」，不足 500 套则补齐。可重复执行。
 * --reset：只把夹具房源恢复成「已上架」（每轮验收前用），不新建。
 * --trash：把夹具楼盘与房源移进回收站（软删，可恢复）。**跑 E2E 前必须做**：夹具房源更新时间最新、
 *   且没有供给商户，会占满列表第一页、被「任取一套已上架房源」的 spec 选中后恢复上架失败（NO_SUPPLY_MERCHANT）。
 *   默认模式与 --reset 会把回收站里的夹具一并恢复。
 *
 * 夹具楼盘 slug `opt-114-bulk-fixture`，房源 slug `opt-114-fixture-NNN`，量完可在后台按楼盘筛出处理。
 */
import { getPayload } from 'payload'

import config from './src/payload.config'
import { assertSeedTargetFromProcessEnv } from './src/lib/runtime/seed-target-guard'

const BUILDING_SLUG = 'opt-114-bulk-fixture'
const TEMPLATE_BUILDING_SLUG = 'huangpu-bund'
const TOTAL = 500

function idOf(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' ? id : null
  }
  return null
}

async function main(): Promise<void> {
  assertSeedTargetFromProcessEnv()
  const resetOnly = process.argv.includes('--reset')
  const toTrash = process.argv.includes('--trash')
  const payload = await getPayload({ config })

  let building = (
    await payload.find({
      collection: 'buildings',
      where: { slug: { equals: BUILDING_SLUG } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      trash: true,
    })
  ).docs[0]

  if (toTrash) {
    if (!building) throw new Error(`夹具楼盘 ${BUILDING_SLUG} 不存在，无需移入回收站`)
    const now = new Date().toISOString()
    const listings = await payload.update({
      collection: 'listings',
      where: { and: [{ building: { equals: building.id } }, { deletedAt: { exists: false } }] },
      data: { deletedAt: now } as never,
      overrideAccess: true,
      trash: true,
    })
    if (!building.deletedAt) {
      await payload.update({
        collection: 'buildings',
        id: building.id,
        data: { deletedAt: now } as never,
        overrideAccess: true,
        trash: true,
      })
    }
    console.log(`夹具移入回收站：房源 ${listings.docs.length} 套，失败 ${listings.errors.length}；楼盘 #${building.id}`)
    process.exit(listings.errors.length > 0 ? 1 : 0)
  }

  if (building?.deletedAt) {
    await payload.update({
      collection: 'buildings',
      id: building.id,
      data: { deletedAt: null } as never,
      overrideAccess: true,
      trash: true,
    })
    console.log(`夹具楼盘 #${building.id} 已从回收站恢复`)
  }

  if (!building) {
    if (resetOnly) throw new Error(`夹具楼盘 ${BUILDING_SLUG} 不存在，先不带 --reset 跑一次`)
    const template = (
      await payload.find({
        collection: 'buildings',
        where: { slug: { equals: TEMPLATE_BUILDING_SLUG } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0]
    if (!template) throw new Error(`模板楼盘 ${TEMPLATE_BUILDING_SLUG} 不存在，先跑 pnpm seed`)
    building = await payload.create({
      collection: 'buildings',
      overrideAccess: true,
      data: {
        name: 'OPT-114 批量下架压测楼盘',
        slug: BUILDING_SLUG,
        city: idOf(template.city),
        district: idOf(template.district),
        status: 'published',
        grade: 'grade-a',
        address: 'OPT-114 本地验收夹具',
        summary: 'OPT-114 本地验收夹具，可删除。',
      } as never,
    })
    console.log(`已建夹具楼盘 #${building.id}`)
  }

  const existing = await payload.find({
    collection: 'listings',
    where: { building: { equals: building.id } },
    limit: TOTAL + 50,
    depth: 0,
    overrideAccess: true,
    trash: true,
    select: { slug: true, publicationStatus: true, deletedAt: true },
  })

  let restored = 0
  for (const doc of existing.docs) {
    if (doc.publicationStatus === 'published' && !doc.deletedAt) continue
    await payload.update({
      collection: 'listings',
      id: doc.id,
      overrideAccess: true,
      trash: true,
      data: { publicationStatus: 'published', deletedAt: null } as never,
    })
    restored += 1
  }
  console.log(`夹具房源 ${existing.docs.length} 套，恢复上架 ${restored} 套`)
  if (resetOnly) {
    process.exit(0)
  }

  const have = new Set(existing.docs.map((d) => d.slug))
  let created = 0
  const started = Date.now()
  for (let n = 1; n <= TOTAL; n += 1) {
    const slug = `opt-114-fixture-${String(n).padStart(3, '0')}`
    if (have.has(slug)) continue
    const floor = Math.ceil(n / 20) + 2
    await payload.create({
      collection: 'listings',
      overrideAccess: true,
      data: {
        title: `OPT-114 夹具 ${floor} 层 ${String(n).padStart(3, '0')} 室`,
        slug,
        roomNumber: `${floor}${String(((n - 1) % 20) + 1).padStart(2, '0')}`,
        status: 'available',
        reviewStatus: 'approved',
        publicationStatus: 'published',
        listingType: 'traditional-office',
        building: building.id,
        rent: 6 + (n % 10) * 0.5,
        rentUnit: 'rmb-sqm-day',
        area: 80 + (n % 30) * 10,
        availableFrom: '2026-11-01',
      } as never,
    })
    created += 1
    if (created % 50 === 0) console.log(`  已建 ${created} 套…`)
  }
  console.log(`新建 ${created} 套，用时 ${((Date.now() - started) / 1000).toFixed(1)}s；楼盘 #${building.id}`)
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
