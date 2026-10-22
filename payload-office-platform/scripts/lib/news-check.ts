/**
 * 一篇资讯发布前的全部检查（OPT-124），`news:check` 与 `news:publish` 共用：
 *
 * 1. 内容规则与封面（lintArticle / lintCover，与单测同一份）
 * 2. 数字核对：每个数都要在 numbers.json 里找得到；numbers.json 不能太旧
 * 3. 线上核对（可关）：关联的行政区 / 商圈 / 楼盘查得到；正文站内链接返回 200；
 *    关联区域的落地页不公开时只给提醒（详情页会只显示名称、不带链接）
 */
import fs from 'node:fs'

import { articleLinks, articleTexts, lintArticle, lintCover, resolveRelated, type ArticleFile } from './article-content'
import { checkNumbers, freshnessProblem, parseNumbersFile } from './news-numbers'
import { publicSlugLookup, type Fetch } from './news-publish'

export type CheckReport = Readonly<{ problems: string[]; warnings: string[]; numbersChecked: number }>

export async function runArticleChecks(input: Readonly<{
  article: ArticleFile
  contentDir: string
  numbersFile: string
  maxAgeHours: number
  strict: boolean
  now: Date
  /** null = 跳过线上核对（离线时用；发布前不要跳） */
  remote: Readonly<{ baseUrl: string; fetchImpl: Fetch; citySlug: string }> | null
}>): Promise<CheckReport> {
  const { article } = input
  const problems = [...lintArticle(article), ...(await lintCover(input.contentDir, article))]
  const warnings: string[] = []

  let numbersChecked = 0
  try {
    const numbers = parseNumbersFile(JSON.parse(fs.readFileSync(input.numbersFile, 'utf8')) as unknown, input.numbersFile)
    const stale = freshnessProblem(numbers.asOf, input.now, input.maxAgeHours)
    if (stale) problems.push(stale)
    const result = checkNumbers(articleTexts(article), numbers, { strict: input.strict })
    numbersChecked = result.checked
    for (const t of result.unmatched) problems.push(`数字「${t.raw}${t.unit ?? ''}」在 numbers.json 里找不到出处（${t.source}：…${t.context}…）`)
  } catch (error) {
    problems.push(`numbers.json：${error instanceof Error ? error.message : String(error)}`)
  }

  const remote = input.remote
  if (remote) {
    try {
      await resolveRelated(article, publicSlugLookup(remote.baseUrl, remote.fetchImpl))
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
    for (const slug of article.relatedDistricts ?? []) {
      const res = await remote.fetchImpl(`${remote.baseUrl}/${remote.citySlug}/area/${encodeURIComponent(slug)}`)
      if (res.status !== 200) warnings.push(`关联区域 ${slug} 的落地页返回 ${res.status}：详情页的「相关推荐」只会显示名称、不带链接，落地页上也看不到这篇`)
    }
    for (const url of articleLinks(article)) {
      if (!url.startsWith('/')) continue
      if (url === `/news/${article.slug}`) continue
      const res = await remote.fetchImpl(`${remote.baseUrl}${url}`)
      if (res.status !== 200) problems.push(`站内链接 ${url} 返回 HTTP ${res.status}`)
    }
  }
  return { problems, warnings, numbersChecked }
}
