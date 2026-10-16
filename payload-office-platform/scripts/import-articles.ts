/**
 * 把 content/articles/*.md 导入「资讯中心」（Articles）。
 *
 * 为什么是文件 + 脚本而不是直接在后台手填：内容要过评审、要有版本、数据类文章的数字要能追溯到口径，
 * 放进仓库才能走 PR；文件校验（篇幅、SEO 字段、站内链接、禁用词）由 tests/article-content-files.test.ts 守着。
 *
 * ## 用法
 *
 *   pnpm node --env-file-if-exists=.env.local --import tsx scripts/import-articles.ts --check
 *       只读：校验全部文件并打印清单（默认）。不连库。
 *   pnpm node --env-file-if-exists=.env.local --import tsx scripts/import-articles.ts --emit=<file.json>
 *       不连库：把将要写入的字段（含 Lexical 正文）导出成 JSON，供没有 DATABASE_URL 的环境（如经 CloudBase MCP）使用。
 *   pnpm node --env-file-if-exists=.env.local --import tsx scripts/import-articles.ts --execute [--status=draft|published]
 *       用 Payload Local API 按 slug 幂等 upsert，需要 DATABASE_URL。默认写成**草稿**。
 *
 * ## 红线
 *
 * - 默认草稿：上线前要有人通读一遍、补封面图，再在后台点发布（或显式传 `--status=published`）。
 * - 封面：`content/articles/covers/<slug>.jpg` 存在就上传到媒体库（usage=article，不打水印）并设为封面，但**只在文章还没有封面时**设置；
 *   `--replace-covers` 才强制覆盖。不写 `isHomeFeatured`（首页主推由运营决定）。
 * - 已存在同 slug 的文章会被**覆盖**正文与 SEO 字段，但不会改动其封面、首页主推和排序。
 * - 生产库不要用本机直连：本机没有、也不应该有生产 DATABASE_URL，见 --emit。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { coverPathFor, loadArticleFiles, toArticleData } from './lib/article-content'

const here = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.resolve(here, '../content/articles')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const articles = loadArticleFiles(CONTENT_DIR)
  const status = arg('status') ?? 'draft'
  if (status !== 'draft' && status !== 'published') throw new Error(`--status 只能是 draft 或 published，得到 ${status}`)
  const now = new Date()

  // biome-ignore lint/suspicious/noConsole: CLI script
  console.log(`[import-articles] ${articles.length} 篇通过校验：`)
  for (const a of articles) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log(`  - ${a.slug}（${a.category}，正文 ${a.length} 字）`)
  }

  const emit = arg('emit')
  if (emit) {
    // cover 只给出文件与替代文本：图片本身要经后台 / 媒体库上传（生产媒体在 COS），不嵌进 JSON
    const docs = articles.map((a) => {
      const cover = coverPathFor(CONTENT_DIR, a.slug)
      return {
        data: toArticleData(a, { status, now }),
        cover: cover ? { file: path.relative(process.cwd(), cover), alt: a.coverAlt } : null,
      }
    })
    fs.writeFileSync(emit, JSON.stringify(docs, null, 2))
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log(`[import-articles] 已导出 ${docs.length} 篇（status=${status}）→ ${emit}`)
    return
  }

  if (!flag('execute')) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log('[import-articles] 仅校验，未写库。要写库请加 --execute（默认草稿）。')
    return
  }

  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const { upsertBySlug } = await import('../src/lib/runtime/upsert-by-slug')
  const payload = await getPayload({ config })
  let created = 0
  let updated = 0
  let covered = 0
  for (const a of articles) {
    // 已存在的文章保留原发布时间（见 toArticleData）；trash:true 与 upsertBySlug 同口径，回收站里的行也要找到
    const existing = await payload.find({ collection: 'articles', where: { slug: { equals: a.slug } }, limit: 1, trash: true, depth: 0 })
    const existingPublishedAt = (existing.docs[0] as { publishedAt?: string | null } | undefined)?.publishedAt ?? null
    const result = await upsertBySlug<{ id: number; coverImage?: unknown }>(payload, 'articles', a.slug, toArticleData(a, { status, now, existingPublishedAt }))
    if (result.created) created += 1
    else updated += 1

    const coverFile = coverPathFor(CONTENT_DIR, a.slug)
    if (!coverFile) continue
    // 已有同名素材就复用，不重复上传；usage 必须是 article，否则会被当成房源实景打水印
    const filename = `${a.slug}.jpg`
    const found = await payload.find({ collection: 'media', where: { filename: { equals: filename } }, limit: 1 })
    const media = found.docs[0] ?? (await payload.create({
      collection: 'media',
      data: { alt: a.coverAlt ?? a.title, usage: 'article' },
      filePath: coverFile,
    }))
    // 只在文章还没有封面时设置：运营在后台换过的封面不能被下一次导入悄悄改回去，要强制覆盖加 --replace-covers
    if (result.doc.coverImage == null || flag('replace-covers')) {
      await payload.update({ collection: 'articles', id: result.doc.id, data: { coverImage: media.id } })
      covered += 1
    }
  }
  // biome-ignore lint/suspicious/noConsole: CLI script
  console.log(`[import-articles] 完成：新建 ${created}，更新 ${updated}，设置封面 ${covered}（status=${status}）`)
  await payload.db.destroy?.()
}

// 显式退出：Payload 初始化后会留下常驻句柄（连接池 / 任务队列），不退出的话进程会一直挂着
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[import-articles] failed:', err)
    process.exit(1)
  })
