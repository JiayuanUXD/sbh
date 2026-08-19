import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Listings } from '@/collections/Listings'
import { OPERATION_CODES } from '@/domain/auth/permission-codes'
import { REVIEW_DECISIONS, REVIEW_DECISION_LABELS } from '@/domain/review/review-status'

const read = (rel: string) => readFile(join(process.cwd(), rel), 'utf8')

/**
 * 免审直发入口下线（OPT-033 A）。
 *
 * 「有人点一下就跳过审核」这个动作没了；`fast_track` 这个**枚举值**留着，
 * 改由平台管理员保存房源时自动产生，用于把「管理员直发」与「走完人工审核」
 * 在审计上区分开。所以这组测试守两件事：
 *   1. 触发面（UI / 权限码 / 端点受理）确实清干净了；
 *   2. 枚举值和状态机路径**没有**被顺手删掉——删了就得再动一次 PG 枚举，
 *      而 CLAUDE.md 记着这类操作已在生产炸过两次。
 */

type AnyField = Record<string, any>

function walk(nodes: AnyField[], visit: (n: AnyField) => void) {
  for (const n of nodes) {
    visit(n)
    if (Array.isArray(n.fields)) walk(n.fields, visit)
    if (Array.isArray(n.tabs)) walk(n.tabs, visit)
  }
}

describe('fast-track-retired/触发面已清干净', () => {
  it('房源编辑页不再注册直发 ui 字段', () => {
    const hits: string[] = []
    walk(Listings.fields as AnyField[], (n) => {
      const field = n.admin?.components?.Field
      const path = typeof field === 'object' ? field?.path : field
      if (typeof path === 'string' && path.includes('FastTrack')) hits.push(path)
    })
    expect(hits).toEqual([])
  })

  it('专属权限码已移除', () => {
    expect(OPERATION_CODES).not.toContain('listing:fast_track_review')
  })

  it('组件文件已删除', async () => {
    await expect(read('src/components/admin/ListingFastTrackAction.tsx')).rejects.toThrow()
    await expect(read('src/components/admin/ListingFastTrackActionClient.tsx')).rejects.toThrow()
  })

  it('importMap 里没有残留（残留会指向不存在的模块）', async () => {
    const src = await read('src/app/(payload)/admin/importMap.js')
    expect(src).not.toContain('FastTrack')
  })

  it('审核端点明确拒绝外部传入的 fast_track', async () => {
    const src = await read('src/endpoints/listing-review-decision-endpoint.ts')
    expect(src).toMatch(/decision === 'fast_track'[\s\S]{0,200}status: 400/)
    // 专属权限门也应一并撤掉
    expect(src).not.toContain('listing:fast_track_review')
  })
})

describe('fast-track-retired/枚举与状态机保留', () => {
  it('fast_track 枚举值保留（删了要重建 PG 类型，且管理员直发还要用它记审计）', () => {
    expect(REVIEW_DECISIONS).toContain('fast_track')
    expect(REVIEW_DECISION_LABELS.fast_track).toBeTruthy()
  })
})
