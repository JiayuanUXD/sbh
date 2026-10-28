/**
 * 资讯发布前检查一篇（OPT-124）：内容规则、封面、数字核对、关联与站内链接。只读。
 *
 *   pnpm news:check --slug=<slug> --numbers=<numbers.json> [--max-age-hours=36] [--strict] [--base-url=https://shangban.cc] [--offline]
 *
 * 有任何问题退出码 1，并逐条列出（数字问题带出处与上下文）。规则说明见 scripts/lib/news-check.ts 与 news-numbers.ts。
 * --offline：跳过线上核对（关联是否存在、站内链接是否 200），只在没网时用；发布脚本不会跳过。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadArticleFiles, selectArticles } from '../lib/article-content'
import { runArticleChecks } from '../lib/news-check'

const here = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.resolve(here, '../../content/articles')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const slug = arg('slug')
  const numbersFile = arg('numbers')
  if (!slug || !numbersFile) throw new Error('用法：pnpm news:check --slug=<slug> --numbers=<numbers.json>')
  const [article] = selectArticles(loadArticleFiles(CONTENT_DIR), slug)
  const baseUrl = (arg('base-url') ?? 'https://shangban.cc').replace(/\/+$/, '')
  const report = await runArticleChecks({
    article,
    contentDir: CONTENT_DIR,
    numbersFile,
    maxAgeHours: Number(arg('max-age-hours') ?? 36),
    strict: flag('strict'),
    now: new Date(),
    remote: flag('offline') ? null : { baseUrl, fetchImpl: fetch, citySlug: arg('city') ?? 'shanghai' },
  })
  // biome-ignore lint/suspicious/noConsole: CLI script
  const log = (...args: unknown[]) => console.log('[news:check]', ...args)
  log(`${slug}：正文 ${article.length} 字，核对数字 ${report.numbersChecked} 个`)
  for (const w of report.warnings) log(`  ! ${w}`)
  for (const p of report.problems) log(`  ✗ ${p}`)
  if (report.problems.length > 0) {
    log(`不通过：${report.problems.length} 个问题`)
    process.exitCode = 1
    return
  }
  log('通过')
}

main().catch((err) => {
  console.error('[news:check] failed:', err)
  process.exit(1)
})
