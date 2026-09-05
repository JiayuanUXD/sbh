/**
 * OPT-069 存量媒体 `usage` 回填。
 *
 * `Media.usage` 的 defaultValue 是 `listing-photo`，但**默认值只对新建记录生效**，
 * 迁移给存量行填的也是这个默认值——于是 logo、文章配图、页面背景全被标成实景图，
 * 一旦跑水印回刷就会被打上水印。本脚本按引用关系纠正。
 *
 * ## REFERENCE_SOURCES 的路径是逐个核实过的，不是照抄 collection 里 `relationTo: 'media'`
 * 出现的位置推出来的占位路径。核实方式：向上找到字段所在的具名 array/group 再拼点号路径；
 * 不带名字的 `tabs`/`row` 只是 UI 分组，不出现在路径里。核实中发现原始占位路径里有三处
 * 实际不存在（`floorPlans.resource`、`blocks.image`、`attachments`、以及 CitySiteProfiles
 * 的 `ogImage`/`heroImage`/`typeCards.image`）——这些字段名在对应 collection 里根本不存在，
 * 已替换为真实路径，见下方 REFERENCE_SOURCES 与 GLOBAL_REFERENCE_SOURCES。
 *
 * ## 用法（默认 dry-run，不写任何东西）
 *
 * ```bash
 * pnpm media:backfill-usage              # 只统计各类多少张
 * pnpm media:backfill-usage --execute    # 真回填
 * ```
 *
 * 幂等：重复跑结果一致（分类只依赖引用关系，不依赖当前 usage 值）。这也是为什么
 * `--execute` 的写入循环故意不做 `--limit`/`--start-after` 续跑游标（对比
 * `backfill-media-sizes.ts`）：单条失败直接重跑整个 `--execute` 就会重新算出剩余
 * delta 并完成，游标反而是多余的机制。
 */

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { classifyMediaUsage, extractMediaIds, type MediaReferenceCounts, type MediaUsage } from '../src/domain/media/usage-classify'

const EXECUTE = process.argv.includes('--execute')
const PAGE_SIZE = 200

/**
 * 每个来源集合里，指向 media 的字段路径。新增引用点时必须同步这里。
 *
 * 路径是怎么核实的（`grep -n "relationTo: 'media'" -B 12 <文件>` 后逐处向上找具名容器）：
 *   - Listings / Buildings：封面图与相册都挂在**无 name 的 tabs**（纯 UI 分组，不影响路径），
 *     `gallery`/`mediaItems` 才是真正的具名 array。楼盘/房源没有独立的 `floorPlans` 字段——
 *     空间图/平面图是 `mediaItems` 里 `kind: 'floor-plan'` 的一行，已经被 `mediaItems.resource`
 *     覆盖，brief 里的 `floorPlans.resource` 路径在源码里根本不存在。
 *   - Articles：`coverImage` 同样挂在无 name 的 tabs 下，路径就是字段名本身。
 *   - Pages：背景图在具名 group `hero` 下，真实路径是 `hero.image`；Pages.ts 里
 *     没有任何 `blocks` 字段，brief 的 `blocks.image` 不存在。
 *   - Locations：`coverImage` 直接挂在顶层 fields（外层只有无 name 的 `row` 分组），
 *     路径就是字段名本身。
 *   - CitySiteProfiles：`heroMedia`/`heroVideo` 挂在无 name 的 tabs 下，路径是字段名本身；
 *     覆盖卡的具名 array 实际叫 `typeCardOverrides`，子字段是 `coverImage`（不是
 *     `image`）。brief 里的 `ogImage`、`heroImage`、`typeCards.image` 在这个 collection
 *     里都不存在——`typeCards` 是 SiteSettings（Global）里同名但不同路径的另一个数组，
 *     `ogImage`/`heroImage` 整个 collection 都没有这两个字段名。
 *   - ListingReports：证据材料的具名 array 实际叫 `evidence`，子字段是 `image`；
 *     brief 里的 `attachments` 这个字段名在源码里不存在。
 */
const REFERENCE_SOURCES: Array<{
  collection: string
  paths: string[]
  bucket: keyof MediaReferenceCounts
}> = [
  { collection: 'listings', paths: ['coverImage', 'gallery.image', 'mediaItems.resource'], bucket: 'listingPhoto' },
  { collection: 'buildings', paths: ['coverImage', 'gallery.image', 'mediaItems.resource'], bucket: 'listingPhoto' },
  { collection: 'articles', paths: ['coverImage'], bucket: 'article' },
  { collection: 'pages', paths: ['hero.image'], bucket: 'brand' },
  { collection: 'locations', paths: ['coverImage'], bucket: 'brand' },
  {
    collection: 'city-site-profiles',
    paths: ['heroMedia', 'heroVideo', 'typeCardOverrides.coverImage'],
    bucket: 'brand',
  },
  { collection: 'listing-reports', paths: ['evidence.image'], bucket: 'report' },
]

/**
 * Global（非 collection）里指向 media 的字段路径。
 *
 * `payload.findGlobal` 是单例读取，不支持分页也不支持 `where` 存在性过滤——
 * 直接整份读回来，用同一套 `extractMediaIds` 按路径抽取即可。
 *
 * brief 的 Step 4b 明确要求把 `src/globals/SiteSettings.ts` 也纳入核实范围，但 Step 5
 * 给出的 REFERENCE_SOURCES 伪代码只处理 collection、完全遗漏了这个 Global——
 * `logo`（站点 Logo）与 `typeCards.coverImage`（首页「按类型浏览」五卡封面，注意子字段
 * 是 `coverImage` 不是 brief 猜测的 `image`）两处引用如果不查，这批品牌素材会在
 * REFERENCE_SOURCES 里查无引用而落到 `other`——不危险（`other` 不会被打水印）但分类不准。
 * 因此在这里单独补上，不跟 collection 那套 `where` 分页逻辑混在一起。
 */
const GLOBAL_REFERENCE_SOURCES: Array<{
  global: string
  paths: string[]
  bucket: keyof MediaReferenceCounts
}> = [{ global: 'site-settings', paths: ['logo', 'typeCards.coverImage'], bucket: 'brand' }]

async function main(): Promise<void> {
  const payload = await getPayload({ config })

  // 一次性把所有引用关系读进内存：媒体量级 ~1.7 万，引用文档更少，够用。
  const counts = new Map<number, MediaReferenceCounts>()
  const bump = (id: number, bucket: keyof MediaReferenceCounts) => {
    const current = counts.get(id) ?? { listingPhoto: 0, article: 0, brand: 0, report: 0 }
    current[bucket] += 1
    counts.set(id, current)
  }

  for (const source of REFERENCE_SOURCES) {
    for (const path of source.paths) {
      let page = 1
      for (;;) {
        const result = await payload.find({
          collection: source.collection as Parameters<typeof payload.find>[0]['collection'],
          depth: 0,
          limit: PAGE_SIZE,
          page,
          sort: 'id',
          overrideAccess: true,
          where: { [path]: { exists: true } },
        })
        for (const doc of result.docs as unknown as Array<Record<string, unknown>>) {
          for (const id of extractMediaIds(doc, path)) bump(id, source.bucket)
        }
        if (!result.hasNextPage || result.nextPage == null) break
        page = result.nextPage
      }
    }
  }

  for (const source of GLOBAL_REFERENCE_SOURCES) {
    const doc = await payload.findGlobal({
      slug: source.global as Parameters<typeof payload.findGlobal>[0]['slug'],
      depth: 0,
      overrideAccess: true,
    })
    for (const path of source.paths) {
      for (const id of extractMediaIds(doc as unknown as Record<string, unknown>, path)) bump(id, source.bucket)
    }
  }

  // 逐条媒体定分类
  const planned = new Map<MediaUsage, number[]>()
  let page = 1
  for (;;) {
    const result = await payload.find({
      collection: 'media',
      depth: 0,
      limit: PAGE_SIZE,
      page,
      sort: 'id',
      overrideAccess: true,
    })
    for (const doc of result.docs as Array<{ id: number; usage?: string | null }>) {
      const usage = classifyMediaUsage(
        counts.get(doc.id) ?? { listingPhoto: 0, article: 0, brand: 0, report: 0 },
      )
      if (doc.usage === usage) continue
      const bucket = planned.get(usage) ?? []
      bucket.push(doc.id)
      planned.set(usage, bucket)
    }
    if (!result.hasNextPage || result.nextPage == null) break
    page = result.nextPage
  }

  for (const [usage, ids] of planned) {
    console.log(`${usage}: ${ids.length} 张需要改`)
  }

  if (!EXECUTE) {
    console.log('dry-run：未写入任何数据。加 --execute 真正回填。')
    return
  }

  // 逐条写入、逐条错误隔离：一条 update 抛错（hook 异常、瞬时 DB 错误）不能冲垮整个
  // ~1.7 万条的 run。失败的 id 记下来但继续处理后面的，跑完打印成功/失败汇总——
  // 对齐 backfill-media-sizes.ts 的既有写法。故意不加 --limit/--start-after 续跑游标：
  // 分类只依赖引用关系、不依赖当前 usage，崩了直接重跑 --execute 就会自动补齐剩余 delta。
  let succeeded = 0
  const failures: Array<{ id: number; reason: string }> = []
  for (const [usage, ids] of planned) {
    let bucketSucceeded = 0
    for (const id of ids) {
      try {
        await payload.update({
          collection: 'media',
          id,
          data: { usage },
          depth: 0,
          overrideAccess: true,
          // 不带 file，watermarkPlugin 的 afterChange 会因为 context 里没有干净母版直接返回
        })
        bucketSucceeded += 1
        succeeded += 1
      } catch (error) {
        failures.push({ id, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    console.log(`${usage}：尝试 ${ids.length} 张，成功 ${bucketSucceeded} 张`)
  }

  console.log(`回填完成：成功 ${succeeded}，失败 ${failures.length}`)
  for (const failure of failures.slice(0, 20)) {
    console.log(`  ✗ #${failure.id} ${failure.reason}`)
  }
  if (failures.length > 20) {
    console.log(`  ...（其余 ${failures.length - 20} 条略）`)
  }
  if (failures.length > 0) {
    console.log('分类只依赖引用关系、不依赖当前 usage：直接重跑 --execute 会重新算出剩余 delta 并完成。')
    process.exitCode = 1
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
