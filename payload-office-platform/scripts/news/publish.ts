/**
 * 资讯日更发布（OPT-124）：先跑与 news:check 相同的全部检查，不通过不发；再用专用后台账号走 REST 新建文章。
 *
 *   SBH_BOT_EMAIL=… SBH_BOT_PASSWORD=… pnpm news:publish --slug=<slug> --numbers=<numbers.json> [--status=draft|published] [--base-url=https://shangban.cc] [--dry-run]
 *
 * - 账号：后台建一个只有「资讯中心」「素材库」两个菜单权限的角色和账号，凭据只放在执行环境的环境变量里，
 *   不要写进仓库或 .env 文件。本脚本不读任何 .env、不连数据库。
 * - 只新建不覆盖：同 slug 已有文章（含回收站）直接停下。
 * - --dry-run：只做检查与只读准备（解析关联、确认 slug 未占用），打印将要提交的字段，不登录、不写。
 * - 输出最后一行是 JSON 结果（id、链接、后台链接、验收问题），方便调用方解析。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { coverPathFor, loadArticleFiles, selectArticles } from '../lib/article-content'
import { runArticleChecks } from '../lib/news-check'
import { executePublish, preparePublish } from '../lib/news-publish'

const here = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.resolve(here, '../../content/articles')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
const flag = (name: string) => process.argv.includes(`--${name}`)
// biome-ignore lint/suspicious/noConsole: CLI script
const log = (...args: unknown[]) => console.log('[news:publish]', ...args)

async function main() {
  const slug = arg('slug')
  const numbersFile = arg('numbers')
  if (!slug || !numbersFile) throw new Error('用法：pnpm news:publish --slug=<slug> --numbers=<numbers.json> [--status=draft|published] [--dry-run]')
  const status = arg('status') ?? 'draft'
  if (status !== 'draft' && status !== 'published') throw new Error(`--status 只能是 draft 或 published，得到 ${status}`)
  const baseUrl = (arg('base-url') ?? 'https://shangban.cc').replace(/\/+$/, '')
  const [article] = selectArticles(loadArticleFiles(CONTENT_DIR), slug)
  const now = new Date()

  const report = await runArticleChecks({
    article,
    contentDir: CONTENT_DIR,
    numbersFile,
    maxAgeHours: Number(arg('max-age-hours') ?? 36),
    strict: flag('strict'),
    now,
    remote: { baseUrl, fetchImpl: fetch, citySlug: arg('city') ?? 'shanghai' },
  })
  for (const w of report.warnings) log(`! ${w}`)
  if (report.problems.length > 0) {
    for (const p of report.problems) log(`✗ ${p}`)
    throw new Error(`检查不通过（${report.problems.length} 个问题），没有发布`)
  }

  const plan = await preparePublish({ article, cover: coverPathFor(CONTENT_DIR, slug), status, baseUrl, fetchImpl: fetch, now })
  if (flag('dry-run')) {
    const fields: Record<string, unknown> = { ...plan.data }
    delete fields.content
    log('dry-run：检查通过，slug 未占用。将要提交：')
    log(JSON.stringify({ ...fields, content: `（Lexical，${article.length} 字）`, cover: plan.cover }, null, 2))
    return
  }

  const email = process.env.SBH_BOT_EMAIL
  const password = process.env.SBH_BOT_PASSWORD
  if (!email || !password) throw new Error('缺少环境变量 SBH_BOT_EMAIL / SBH_BOT_PASSWORD（专用发稿账号），没有发布')
  const result = await executePublish(plan, { baseUrl, fetchImpl: fetch, email, password, title: article.title, coverAlt: article.coverAlt })
  if (result.verifyProblems.length > 0) {
    for (const p of result.verifyProblems) log(`✗ 验收：${p}`)
    process.exitCode = 1
  } else {
    log(`已${status === 'published' ? '发布' : '存为草稿'}：#${result.id} ${result.url}`)
  }
  log(JSON.stringify(result))
}

main().catch((err) => {
  console.error('[news:publish] failed:', err)
  process.exit(1)
})
