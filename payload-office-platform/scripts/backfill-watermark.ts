/**
 * OPT-069 存量图水印回刷：首次备份 + 首次烘焙。
 *
 * ## 铁律：只从确知没有水印的字节烘焙
 *
 * 水印是烘进像素的。一张图一旦被烘过，它当前的文件就不再是干净原件：拿它去备份，等于把
 * 带水印的字节写进 `media-source/` 当「原件」永久保存，唯一的干净副本就此丢失，整个功能
 * 「随时可重刷、可复原」的前提被击穿；拿它去烘，会在第一层水印上叠第二层。
 * 插件只在烘焙完成后才写 `watermark.version`，新字节落地却没烘时又会把它清掉
 * （`bakeAfterUpload` 的不变量：有 version ⟺ 存储字节带着那个版本的水印），所以
 * **有 version 就等于烘过**。每张图按 version 分三种情形处理，**备份只允许写给「没烘过且还没有备份」的图**：
 *
 *   1. 没有 `watermark.version`：没烘成过。`media-source/` 里**已有备份就以备份为准、绝不覆盖**，
 *      没有备份才把当前文件当干净原件写进去；两种情况都随后烘焙。这是首次跑的常态。
 *      为什么不能一律覆盖：烘焙不是原子的（备份 → 覆盖写母版与派生 → 写 version），中途
 *      容器被换掉会让这一行回滚成 version=null，而存储里已经是带水印的母版——那一刻拿它盖掉
 *      备份，仅存的干净原件就没了。备份由 `bakeAfterUpload` 维护（新字节落地时无论开关开关
 *      都写一次），永远是这张图最新的干净原件。
 *   2. `watermark.version` 等于当前配置哈希：已经完成。跳过、计入 skipped，**不读不写任何
 *      存储**。
 *   3. `watermark.version` 存在但不等于当前哈希：按旧配置烘过，当前文件带着旧水印，只能从
 *      `media-source/` 的备份重烘。**没有备份则这张图已不可恢复**——它仅存的字节就是带水印
 *      的那份。不备份、不烘焙，按 error 记下 media id 与 filename，计入失败，继续下一张。
 *
 * 情形 3 缺备份**是数据丢失，不是常规跳过**，必须有人去查：要么桶里的备份被删过，要么这张图
 * 是被某条跳过了备份步骤的代码路径烘的。汇总里单独点名，不许淹没在失败计数里。
 *
 * 三种情形只在 `watermark-rebake.ts` 的 `decideRebakeAction` 里定义一次，本脚本与重刷任务
 * 都调它，**不许自己比 version**：两处各写一份时，同一轮计划评审里就分叉了——脚本把情形 3
 * 缺备份记成数据丢失，重刷任务把它记成常规跳过——而这种分叉没有任何报错。
 *
 * ## 怎么触发烘焙
 *
 * 把干净字节用 `payload.update({ file, overwriteExistingFiles: true })` 同名回写，
 * 重跑整条上传管线，`watermarkPlugin` 自然会烘焙。同名 → `media.url` 不变 →
 * 所有引用它的房源/楼盘/内容页都不用改（这条路子由 OPT-068 的
 * `backfill-media-sizes.ts` 验证过）。
 *
 * ## 续跑
 *
 * 生产约 1.7 万张要分批跑、中途必然中断再续。情形 2 排在任何存储访问之前，续跑时已完成的
 * 图一次存储都不碰——否则每次续跑都要把上万张已完成的图整份从 `media-source/` 下载一遍，
 * 只为确认「备份在」。情形 1 与情形 3 都要知道备份在不在（情形 1 靠它决定烘焙源、要不要写备份，
 * 情形 3 靠它区分可恢复与不可恢复）。重复跑安全。
 *
 * 循环里因此对 `decideRebakeAction` 问两次：第一次 `hasBackup: false`，只为在碰存储之前排除
 * 情形 2；第二次拿真实的 `hasBackup`。**不要把它「优化」成给 `MediaWriter` 加一个 `exists()`**：
 * 情形 2 只看 version、根本不碰存储；情形 1 与情形 3 反正都要把字节整份读出来（有备份就是它、
 * 没备份才读当前文件），先探一次「在不在」只是在必然发生的那次下载前面多加一个往返，
 * 一张图都省不下来。
 *
 * ## 开关关着时拒绝执行
 *
 * `--execute` 前先读站点设置，`watermark.enabled` 为 false 直接退出，提示先去
 * 「站点设置 → 图片水印」打开开关。理由：开关关着时 `bakeAfterUpload` 早退，
 * `payload.update({ file })` 只是把干净字节原样重写一遍，什么都没烘，脚本却会报「烘焙 N 张」，
 * 运营会据此以为存量已处理完。不做「只备份」模式：情形 3 在开关关着时根本无法处理；备份
 * 又只会写给情形 1 的图，而这些图在开关打开后的同一轮里本来就是先备份再烘焙，提前备份
 * 没有任何收益，只多一条要向运营解释的分支。dry-run 不受此限——它不碰存储，开关关着时
 * 照样可以用来看候选数量。
 *
 * ## 读原图字节：直接读存储，不走站点文件路由
 *
 * 情形 1 的当前文件用 `writer.get({ prefix: MEDIA_COS_PREFIX, filename })` 直接按对象键读，
 * 与重刷任务 `rebakeChunk` 同一条通道。站点文件路由（`media.url` → `/api/media/file/<filename>`）
 * 端出来的是 Payload 愿意返回的东西：过 access control、按记录的 `prefix` 字段找键、COS 模式下
 * 再由站点转发一次；存储直读拿到的是 `MEDIA_COS_PREFIX/<filename>` 这个键上**实际存着的字节**
 * ——`watermarkPlugin` 覆盖写、重刷任务读回的都是这个键。本脚本要备份的就是存储里实际存着的
 * 原件，以存储为准。两者在本仓库指向同一份字节（`Media.prefix` 缺省即 `MEDIA_COS_PREFIX`，
 * 插件也写到这个键）；万一某条记录的 `prefix` 与常量不一致，文件路由会顺着记录找到一份，
 * 存储直读则拿到 null——这时按失败记下让人去查，而不是把另一个键上的字节当原件备份。
 *
 * `get` 对不存在的键返回 null，不抛错（HTTP 那条路是 404 抛错）。null 不是「空文件」，是这个键上
 * 没有东西：情形 1 在没有备份、要读当前文件时读到 null 立即 throw，落进该图的 failures、继续下一张——不写备份、不回写，
 * 绝不把 null 往 `writer.put` / `payload.update` 传。
 *
 * ## 前置
 *
 *   1. 先跑 `pnpm media:backfill-usage --execute`，否则 usage 全是默认值。
 *   2. 先跑 `pnpm media:backfill-sizes --execute` 补齐派生（spec §8.1）。
 *
 * 不要求站点服务在跑：脚本直接按对象键读存储，与重刷任务同一条通道（见上「读原图字节」），
 * 只要环境里有存储配置（本地 fs 或 COS，与 `s3Storage({ enabled })` 同一判据）。
 *
 * ## 用法
 *
 * ```bash
 * pnpm media:backfill-watermark                      # dry-run：按三种情形统计张数，不写任何东西；开关关着也能跑
 * pnpm media:backfill-watermark --execute --limit=50 # 真回刷，烘焙满 50 张即停；情形 2 跳过、不计入 limit；开关关着拒跑
 * ```
 *
 * `--execute` 不带 `--limit` 时**默认只做 50 张**（生产约 1.7 万张）。脚本会在开跑前把
 * 「本轮上限」与「待处理总数」明写出来、跑完再报剩余量——不然那句「烘焙 50 张、失败 0 张」
 * 读起来就像已经干完了。重复跑同一条命令即可续跑，已完成的走情形 2、一次存储都不碰。
 */

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { computeWatermarkVersion, isBakeableImage } from '../src/domain/media/watermark'
import { decideRebakeAction } from '../src/domain/media/watermark-rebake'
import { resolveWatermarkConfig } from '../src/domain/media/watermark-settings'
import { MEDIA_COS_PREFIX } from '../src/lib/storage/cos-config'
import { createMediaWriter, MEDIA_SOURCE_PREFIX } from '../src/lib/storage/media-writer'

type MediaDoc = {
  id: number
  filename?: string | null
  mimeType?: string | null
  usage?: string | null
  watermark?: { version?: string | null } | null
}

const EXECUTE = process.argv.includes('--execute')
const LIMIT = readNumberFlag('--limit=', EXECUTE ? 50 : Number.POSITIVE_INFINITY)
/** `--limit` 是不是运营自己指定的。没指定时 `--execute` 会**静默**只做 50 张（见 main 里的提示）。 */
const LIMIT_EXPLICIT = process.argv.some((arg) => arg.startsWith('--limit='))
const PAGE_SIZE = 200

function readNumberFlag(prefix: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(prefix))
  if (!raw) return fallback
  const value = Number(raw.slice(prefix.length))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  const writer = createMediaWriter()
  // 配置只读一次：开关状态与当前版本都从这一份来，循环里逐张比对。
  // 读取路径与烘焙插件、重刷任务共用（`domain/media/watermark-settings.ts`）——
  // `watermark.version` 是这份配置的哈希，本脚本若换一种读法算出另一个哈希，版本判定
  // 永远不命中，续跑退化成全量重烘，且没有任何报错。
  const watermarkConfig = await resolveWatermarkConfig(payload)
  const currentVersion = computeWatermarkVersion(watermarkConfig)

  const candidates: MediaDoc[] = []
  let page = 1
  for (;;) {
    const result = await payload.find({
      collection: 'media',
      depth: 0,
      limit: PAGE_SIZE,
      page,
      sort: 'id',
      overrideAccess: true,
      where: { usage: { equals: 'listing-photo' } },
    })
    for (const doc of result.docs as unknown as MediaDoc[]) {
      // 与 bakeAfterUpload / selectRebakeTargets 同一个谓词。这里若放进 gif / svg：
      // 备份与同名回写都会「成功」，烘焙却在 bakeAfterUpload 早退、version 永远写不上，
      // 脚本报的 baked 数虚高，下次 --execute 又把它们算成候选。
      if (isBakeableImage(doc.mimeType)) candidates.push(doc)
    }
    if (!result.hasNextPage || result.nextPage == null) break
    page = result.nextPage
  }

  const neverBaked = candidates.filter((doc) => !doc.watermark?.version).length
  const alreadyCurrent = candidates.filter((doc) => doc.watermark?.version === currentVersion).length
  const stale = candidates.length - neverBaked - alreadyCurrent
  console.log(
    `usage=listing-photo 的图片共 ${candidates.length} 张：从没烘过 ${neverBaked} 张（首次备份 + 烘焙），` +
      `已是当前配置版本 ${alreadyCurrent} 张（跳过、不碰存储），旧配置版本 ${stale} 张（只能从 media-source/ 备份重烘）`,
  )
  if (!EXECUTE) {
    if (!watermarkConfig.enabled) {
      console.log('注意：水印开关当前关闭，--execute 会拒跑；先去「站点设置 → 图片水印」勾上「启用水印」并保存。')
    }
    console.log('dry-run：未写入任何数据。加 --execute 真正回刷，建议配 --limit 分批。')
    return
  }
  if (!watermarkConfig.enabled) {
    // 开关关着时 bakeAfterUpload 早退，下面的 payload.update({ file }) 只把干净字节原样重写一遍，
    // 什么都没烘，却会被数成「烘焙 N 张」——运营会据此以为存量已处理完。宁可拒跑。
    console.error('拒绝执行：水印开关关闭。先去「站点设置 → 图片水印」勾上「启用水印」并保存，再跑 --execute。未写入任何数据。')
    process.exit(1)
  }

  // 本轮真正要处理的张数（已是当前版本的不算）。`--limit` 默认只有 50，而生产有约 1.7 万张：
  // 不把「本轮上限」和「还剩多少」明写出来，运营跑一条光秃秃的 `--execute` 会拿到
  // 「烘焙 50 张、失败 0 张」这种读起来像干完了的汇总，然后以为存量处理完了。
  const pending = candidates.length - alreadyCurrent
  console.log(
    `本轮最多烘焙 ${Number.isFinite(LIMIT) ? LIMIT : '不限'} 张` +
      `${LIMIT_EXPLICIT ? '（--limit）' : '（未指定 --limit，用默认 50）'}，` +
      `待处理共 ${pending} 张。` +
      (pending > LIMIT
        ? `本轮跑完还会剩约 ${pending - LIMIT} 张，重复跑同一条命令即可续（已完成的会被跳过、不碰存储）。`
        : ''),
  )

  let backedUp = 0
  let baked = 0
  let skipped = 0
  let unrecoverable = 0
  const failures: Array<{ id: number; reason: string }> = []

  for (const doc of candidates) {
    // --limit 只数真正烘焙的张数。分批续跑时排在前面的都是已完成的图，若按候选数切片，
    // 第二批起每次看到的永远是同一批已完成的图，永远跑不到后面。
    if (baked >= LIMIT) break

    const storedVersion = doc.watermark?.version
    // 情形 2 必须排在任何存储访问之前（头注释「续跑」）。skip 的判定不看 hasBackup——
    // decideRebakeAction 的单测锁住了这条性质——所以先按 hasBackup=false 问一次，命中就不查备份。
    // 这里不许自己比 version：三种情形只在 decideRebakeAction 里定义。
    // 问两次是刻意的，不要换成 exists()（头注释「续跑」）：另外两种情形反正都要整份读字节。
    if (decideRebakeAction({ storedVersion, currentVersion, hasBackup: false }) === 'skip') {
      skipped++
      continue
    }

    try {
      if (!doc.filename || !doc.mimeType) throw new Error('缺 filename / mimeType')

      const backup = await writer.get({ prefix: MEDIA_SOURCE_PREFIX, filename: doc.filename })
      const action = decideRebakeAction({ storedVersion, currentVersion, hasBackup: backup !== null })

      // 余下两种情形都只从确知没有水印的字节烘焙，绝不拿烘过的当前文件当原件。
      let clean: Buffer
      switch (action) {
        case 'skip':
          // 上面已按 hasBackup=false 排除；留着这个分支只为穷举。
          skipped++
          continue
        case 'backup-and-bake': {
          // 情形 1：没烘成过。**备份已存在就以备份为准，且一个字节都不往 media-source/ 写**——
          // 「没有 version」不等于「当前文件一定干净」：烘焙不是原子的（备份 → 覆盖写母版与
          // 派生 → 写 version），中途容器被换掉（生产分批跑 1.7 万张，期间一次部署就够了）
          // 会让这一行回滚成 version=null，而存储里已经是带水印的母版。这时拿当前文件覆盖备份，
          // 等于把上一次刚存下的干净原件永久换成带水印的字节，重烘还会叠第二层。
          // 备份由 bakeAfterUpload 维护（新字节落地时无论开关开关都写），永远是最新的干净原件。
          //
          // 备份不存在时才读当前文件当原件——首次回刷的常态。直接按对象键读存储，与 rebakeChunk
          // 同一条通道（头注释「读原图字节」）。get 对不存在的键返回 null：不是空文件，是这个键上
          // 没有东西。抛错记进该图的 failures、继续下一张，绝不把 null 写进 media-source/
          // 或传给 payload.update。
          if (backup) {
            clean = backup
            break
          }
          const current = await writer.get({ prefix: MEDIA_COS_PREFIX, filename: doc.filename })
          if (!current) {
            throw new Error(`读不到当前文件 ${MEDIA_COS_PREFIX}/${doc.filename}：存储里没有这个键，未备份、未烘焙`)
          }
          clean = current
          await writer.put({
            prefix: MEDIA_SOURCE_PREFIX,
            filename: doc.filename,
            body: clean,
            mimeType: doc.mimeType,
          })
          backedUp++
          break
        }
        case 'bake-from-backup':
          // 情形 3：按旧配置烘过，当前文件带着旧水印，只能从备份重烘。
          if (!backup) throw new Error('decideRebakeAction 返回 bake-from-backup 但备份为空')
          clean = backup
          break
        case 'unrecoverable': {
          // 情形 3 缺备份：数据丢失，不是常规跳过。仅存的字节带着水印——既不能当原件备份
          // （会把带水印的字节永久存成「原件」），也不能再烘（会叠第二层）。记错误、继续下一张。
          unrecoverable++
          const reason =
            `已烘过（version=${storedVersion}）但 ${MEDIA_SOURCE_PREFIX}/${doc.filename} 缺备份，` +
            '干净原件已不可恢复。可能是桶里的备份被删过，或这张图被某条跳过了备份步骤的代码路径烘的，须人工排查'
          console.error(`[backfill-watermark] media #${doc.id} ${doc.filename}：${reason}`)
          failures.push({ id: doc.id, reason })
          continue
        }
      }

      await payload.update({
        collection: 'media',
        id: doc.id,
        data: {},
        depth: 0,
        overrideAccess: true,
        overwriteExistingFiles: true,
        file: { data: clean, mimetype: doc.mimeType, name: doc.filename, size: clean.length },
      })
      baked++
    } catch (error) {
      failures.push({ id: doc.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  console.log(
    `新备份 ${backedUp} 张，烘焙 ${baked} 张，已是当前版本跳过 ${skipped} 张，失败 ${failures.length} 张`,
  )
  const remaining = pending - baked - failures.length
  if (remaining > 0) {
    // 不写这一行，上面那句汇总读起来就像「干完了」。
    console.log(
      `还剩约 ${remaining} 张没处理（本轮 --limit=${LIMIT} 到顶）。重复跑同一条命令续跑：` +
        `pnpm media:backfill-watermark --execute --limit=${Number.isFinite(LIMIT) ? LIMIT : 500}`,
    )
  }
  if (unrecoverable > 0) {
    console.error(
      `其中 ${unrecoverable} 张已烘过但缺 ${MEDIA_SOURCE_PREFIX}/ 备份，干净原件已不可恢复——这是数据丢失，不是跳过，须人工排查（清单见上方 error 行）`,
    )
  }
  for (const failure of failures.slice(0, 20)) {
    console.log(`  #${failure.id} ${failure.reason}`)
  }
  if (failures.length > 20) {
    console.log(`  ...（其余 ${failures.length - 20} 条略）`)
  }
  // unrecoverable 是数据丢失，须人工介入；failures 也可能是瞬时错误。两者都必须体现在退出码上——
  // 这是一次要在约 1.7 万行上无人值守分批跑的脚本，任何基于退出码的告警/cron/CI 闸门都只看
  // exit code，日志再响亮也救不了一次被读成「干净成功」的失败运行。与 backfill-media-usage.ts
  // 同一写法：先设 process.exitCode，主流程末尾沿用它，不被 process.exit(0) 覆盖。
  if (failures.length > 0) {
    process.exitCode = 1
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
