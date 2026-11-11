/**
 * 「已发布的资讯必有发布时间」的写入边界规则（2026-11-11）。
 *
 * 为什么需要：资讯的规范路径是「导入脚本默认写草稿 → 运营在后台把状态改成已发布」。
 * 草稿阶段 frontmatter 不带发布时间，而 `publishedAt` 是可选字段、没有默认值，
 * 改成「已发布」这一步又没有任何 hook，于是库里出现了已发布却没有发布时间的文章：
 * 首页显示「—」、/news 卡片与详情页不渲染日期，且 `ORDER BY published_at DESC`
 * 在 PostgreSQL 里把 NULL 排在最前，没日期的文章反而挤在列表最上面。
 *
 * 规则（只在「发布」这一刻盖章，绝不编造编辑时间）：
 *   - 本次写入后状态不是 published：不动。草稿没有发布时间，提前盖会带一个没发生的时间。
 *   - 已有可解析的发布时间（本次提交的，或库里原有的）：不动。运营指定的日期不被覆盖。
 *   - 否则，若库里原有可解析的发布时间（说明是被清空了）：恢复原值，日期不能被弄丢。
 *   - 否则，若这次是「变成已发布」（新建即已发布，或状态由非 published 改成 published）：盖当前时刻。
 *   - 否则（已发布的历史老文章、本来就没日期，这次只是无关编辑）：不动。
 *     编辑时间不是发布时间；补历史数据走单独的、需人工确认的回填，不靠 hook 顺手盖章。
 */
import type { CollectionBeforeChangeHook } from 'payload'

type Doc = Readonly<Record<string, unknown>>

export type ResolveArticlePublishedAtInput = Readonly<{
  operation: 'create' | 'update'
  /** 本次提交的字段（update 时可能只含被改动的几项，如 REST PATCH `{ status }`） */
  data: Doc
  /** update 时库里改动前的整行；create 时为 undefined */
  originalDoc: Doc | undefined
  now: Date
}>

function toTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * 返回要写入 `publishedAt` 的 ISO 字符串；返回 `undefined` 表示不需要改动。
 * 纯函数：`now` 由调用方传入，便于测试。
 */
export function resolveArticlePublishedAt(input: ResolveArticlePublishedAtInput): string | undefined {
  const { operation, data, originalDoc, now } = input

  const status = 'status' in data ? data.status : originalDoc?.status
  if (status !== 'published') return undefined

  // 提交里带了 publishedAt 键就以它为准（null / 空串 = 被清空），没带键就看库里原值。
  const effective = 'publishedAt' in data ? data.publishedAt : originalDoc?.publishedAt
  if (toTime(effective) !== null) return undefined

  const previous = toTime(originalDoc?.publishedAt)
  if (previous !== null) return new Date(previous).toISOString()

  const becomesPublished = operation === 'create' || originalDoc?.status !== 'published'
  return becomesPublished ? now.toISOString() : undefined
}

export const ensureArticlePublishedAt: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'create' && operation !== 'update') return data
  const value = resolveArticlePublishedAt({
    operation,
    data: data as Doc,
    originalDoc: originalDoc as Doc | undefined,
    now: new Date(),
  })
  return value === undefined ? data : { ...data, publishedAt: value }
}
