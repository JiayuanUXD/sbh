/**
 * 商户指标查询不得按 `deletedAt` 过滤（OPT-065 浏览器走查发现）
 *
 * ## 怎么发现的
 *
 * `/admin/analytics` 渲染出来后，「启用商户」那张卡显示：
 *
 *     启用商户  —  查询失败：The following path cannot be queried: deletedAt
 *
 * Merchants **没有启用 trash**（启用的只有 Listings / Buildings / Leads /
 * Articles / Pages），Payload 直接拒绝这个路径，于是两个商户指标恒为
 * `status=failed`。适配器是从 listing/lead/building 复制过来的——那三个
 * collection 确实有 `deletedAt`。
 *
 * ## 为什么是走查发现的，而不是测试
 *
 * 因为看板把失败卡**渲染成占位并显示错误原文**，而不是过滤掉。
 * 若当初选了「失败就不显示这张卡」，页面上只会少一张卡，
 * 这个 bug 会继续躺着——而这正是 `overview-view-model` 里那条设计决定的理由。
 *
 * 这里用行为测试而不是静态扫描：`deletedAt` 在别的适配器里是**合法**的
 * （lead-queries 同时查 leads / locations / tasks 三个 collection），
 * 按文件粒度的静态规则必然误报。
 */

import { describe, expect, it } from 'vitest'

import {
  countMerchantsActive,
  countMerchantsQualificationExpiring,
} from '@/domain/analytics/queries/merchant-queries'

/** 捕获适配器实际发出的 count 参数 */
function makeCtx() {
  const calls: Array<{ collection: string; where: Record<string, unknown> }> = []
  const ctx = {
    asOf: new Date('2026-09-02T08:00:00.000Z'),
    payload: {
      async count(args: { collection: string; where: Record<string, unknown> }) {
        calls.push({ collection: args.collection, where: args.where })
        return 0
      },
      async find() {
        return { docs: [], totalDocs: 0, totalPages: 1, page: 1 }
      },
    },
    filters: {},
    permission: null,
  }
  return { ctx, calls }
}

/** 递归收集 where 里出现过的所有字段路径（含 and/or 嵌套） */
function collectPaths(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectPaths(item, out)
    return out
  }
  if (typeof node !== 'object' || node === null) return out
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'and' || key === 'or') collectPaths(value, out)
    else out.add(key)
  }
  return out
}

const ADAPTERS = [
  { name: 'countMerchantsActive', fn: countMerchantsActive },
  { name: 'countMerchantsQualificationExpiring', fn: countMerchantsQualificationExpiring },
] as const

describe('商户指标查询', () => {
  for (const adapter of ADAPTERS) {
    it(`${adapter.name} 不按 deletedAt 过滤（Merchants 无 trash，该路径会被 Payload 拒绝）`, async () => {
      const { ctx, calls } = makeCtx()
      await adapter.fn(ctx as never)

      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call.collection).toBe('merchants')
        expect([...collectPaths(call.where)]).not.toContain('deletedAt')
      }
    })
  }

  it('countMerchantsActive 仍按 status=active 过滤（修复不能把过滤条件删光）', async () => {
    const { ctx, calls } = makeCtx()
    await countMerchantsActive(ctx as never)
    expect(calls[0].where).toMatchObject({ status: { equals: 'active' } })
  })

  it('countMerchantsQualificationExpiring 仍按到期区间过滤', async () => {
    const { ctx, calls } = makeCtx()
    await countMerchantsQualificationExpiring(ctx as never)
    expect([...collectPaths(calls[0].where)]).toContain('qualificationExpiredAt')
  })
})
