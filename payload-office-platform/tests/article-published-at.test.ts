import { describe, expect, it } from 'vitest'

import { Articles } from '@/collections/Articles'
import {
  ensureArticlePublishedAt,
  resolveArticlePublishedAt,
} from '@/collections/article-published-at'

/**
 * 「已发布的资讯必有发布时间」（2026-11-11）。
 *
 * 背景：线上 8 篇已发布资讯的 `publishedAt` 是 NULL，首页显示「—」、/news 卡片与详情页不渲染日期。
 * 它们都走的是规范路径——导入脚本默认写草稿（frontmatter 不带发布时间），运营在后台把状态改成
 * 「已发布」，而 Articles 对这一步没有任何约束：发布日期是可选字段、没有默认值、没有 hook。
 *
 * 守卫落在失效点那一层（写入边界），所以除了纯规则，还断言 hook 真的挂在 Articles 的
 * beforeChange 上——只测函数不测挂载，把 hook 摘掉照样全绿。
 */

const NOW = new Date('2026-11-11T06:30:00.000Z')
const resolve = (input: Omit<Parameters<typeof resolveArticlePublishedAt>[0], 'now'>) =>
  resolveArticlePublishedAt({ ...input, now: NOW })

describe('resolveArticlePublishedAt：只在「发布」这一刻盖章，绝不编造编辑时间', () => {
  it('草稿改成已发布、没带发布时间（只传 status，如 REST PATCH）→ 盖发布那一刻', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBe(NOW.toISOString())
  })

  it('草稿改成已发布、后台表单整表提交（publishedAt 为 null）→ 盖发布那一刻', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published', publishedAt: null, title: '标题' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBe(NOW.toISOString())
  })

  it('后台把发布日期留成空串也算没填', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published', publishedAt: '' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBe(NOW.toISOString())
  })

  it('直接以已发布创建、没带发布时间 → 盖创建那一刻', () => {
    expect(resolve({ operation: 'create', data: { status: 'published', slug: 's' }, originalDoc: undefined }))
      .toBe(NOW.toISOString())
  })

  it('运营填了发布日期就原样保留，不覆盖', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published', publishedAt: '2026-10-01T01:00:00.000Z' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBeUndefined()
    expect(resolve({
      operation: 'create',
      data: { status: 'published', publishedAt: '2026-10-01T01:00:00.000Z' },
      originalDoc: undefined,
    })).toBeUndefined()
  })

  it('草稿阶段就带了发布时间（frontmatter 写了 publishedAt）：改成已发布时沿用，不改写', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published' },
      originalDoc: { status: 'draft', publishedAt: '2026-10-05T01:00:00.000Z' },
    })).toBeUndefined()
  })

  it('草稿不盖章：草稿没有「发布时间」，提前盖会让它带着一个没发生的时间', () => {
    expect(resolve({ operation: 'create', data: { status: 'draft' }, originalDoc: undefined })).toBeUndefined()
    expect(resolve({
      operation: 'update',
      data: { title: '改标题' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBeUndefined()
  })

  it('已发布文章被清空发布日期 → 恢复原值，不允许把日期弄丢', () => {
    expect(resolve({
      operation: 'update',
      data: { publishedAt: null },
      originalDoc: { status: 'published', publishedAt: '2026-10-01T01:00:00.000Z' },
    })).toBe('2026-10-01T01:00:00.000Z')
  })

  it('★ 历史上已发布却没日期的老文章：无关编辑（改摘要、切主推、进回收站）不会被盖成「编辑时刻」', () => {
    // 编辑时间不是发布时间；补历史数据走单独的、需确认的回填，不靠 hook 顺手盖章。
    for (const data of [{ excerpt: '改摘要' }, { isHomeFeatured: false }, { deletedAt: NOW.toISOString() }, { publishedAt: null }]) {
      expect(resolve({
        operation: 'update',
        data,
        originalDoc: { status: 'published', publishedAt: null },
      })).toBeUndefined()
    }
  })

  it('已发布且有日期的文章，无关编辑不动发布时间', () => {
    expect(resolve({
      operation: 'update',
      data: { excerpt: '改摘要' },
      originalDoc: { status: 'published', publishedAt: '2026-10-01T01:00:00.000Z' },
    })).toBeUndefined()
  })

  it('不可解析的发布时间按没填处理（不让一个坏字符串顶掉盖章）', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'published', publishedAt: 'not-a-date' },
      originalDoc: { status: 'draft', publishedAt: null },
    })).toBe(NOW.toISOString())
  })

  it('已发布 → 草稿：不碰发布时间（再发布时沿用）', () => {
    expect(resolve({
      operation: 'update',
      data: { status: 'draft' },
      originalDoc: { status: 'published', publishedAt: '2026-10-01T01:00:00.000Z' },
    })).toBeUndefined()
  })
})

describe('ensureArticlePublishedAt hook 与 Articles 的接线', () => {
  type Args = Parameters<typeof ensureArticlePublishedAt>[0]
  const run = (data: Record<string, unknown>, originalDoc: Record<string, unknown> | undefined, operation: 'create' | 'update') =>
    ensureArticlePublishedAt({ data, originalDoc, operation } as unknown as Args)

  it('草稿 → 已发布：hook 把发布时间写进 data，其余字段原样保留', async () => {
    const out = await run({ status: 'published', title: 'T' }, { status: 'draft', publishedAt: null }, 'update') as Record<string, unknown>
    expect(out.title).toBe('T')
    expect(out.status).toBe('published')
    expect(typeof out.publishedAt).toBe('string')
    expect(Number.isNaN(Date.parse(out.publishedAt as string))).toBe(false)
  })

  it('不需要盖章时原样返回 data（同一引用，不凭空多出 publishedAt 键）', async () => {
    const data = { excerpt: '改摘要' }
    const out = await run(data, { status: 'draft', publishedAt: null }, 'update')
    expect(out).toBe(data)
    expect('publishedAt' in (out as Record<string, unknown>)).toBe(false)
  })

  it('★ hook 真的注册在 Articles.hooks.beforeChange 上（只测函数不测挂载，摘掉 hook 照样全绿）', () => {
    expect(Articles.hooks?.beforeChange).toContain(ensureArticlePublishedAt)
  })
})
