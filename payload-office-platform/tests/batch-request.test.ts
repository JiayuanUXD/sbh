import { describe, expect, it } from 'vitest'

import { InvalidOperationError } from '@/domain/shared/errors'
import { TransactionAbortedError } from '@/domain/shared/transaction-safety'
import {
  BATCH_ACTION_MAX_ITEMS,
  batchFailureFromError,
  chunkBatchItems,
  parseBatchItems,
  parseBatchResponse,
  partitionForBatch,
  runChunkedBatch,
  summarizeBatchResults,
  type BatchItem,
  type BatchItemResult,
  type ChunkSendResult,
} from '@/domain/shared/batch-request'

/**
 * 批量动作请求体的条目解析（OPT-113）。
 *
 * 楼盘 / 房源两个批量端点共用：条目里的 id 与版本号来自客户端，一律当 unknown 收口。
 */

describe('parseBatchItems/合法输入', () => {
  it('数字 id + 版本号原样收下', () => {
    expect(parseBatchItems([{ id: 3, expectedVersion: 7 }])).toEqual({
      ok: true,
      items: [{ id: 3, expectedVersion: 7 }],
    })
  })

  it('数字字符串 id 归一成数字（路由参数、表单值常是字符串）', () => {
    expect(parseBatchItems([{ id: '12' }])).toEqual({
      ok: true,
      items: [{ id: 12, expectedVersion: null }],
    })
  })

  it('缺省或 null 的版本号记为 null（不带乐观锁）', () => {
    const result = parseBatchItems([{ id: 1 }, { id: 2, expectedVersion: null }])
    expect(result).toEqual({
      ok: true,
      items: [
        { id: 1, expectedVersion: null },
        { id: 2, expectedVersion: null },
      ],
    })
  })

  it('重复 id 只保留第一次出现（同一行被勾两次不该执行两遍）', () => {
    const result = parseBatchItems([
      { id: 5, expectedVersion: 1 },
      { id: '5', expectedVersion: 9 },
      { id: 6 },
    ])
    expect(result).toEqual({
      ok: true,
      items: [
        { id: 5, expectedVersion: 1 },
        { id: 6, expectedVersion: null },
      ],
    })
  })

  it('恰好上限条数可以通过', () => {
    const raw = Array.from({ length: BATCH_ACTION_MAX_ITEMS }, (_, i) => ({ id: i + 1 }))
    const result = parseBatchItems(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items).toHaveLength(BATCH_ACTION_MAX_ITEMS)
  })
})

describe('parseBatchItems/非法输入', () => {
  it.each([
    ['不是数组', { id: 1 }],
    ['null', null],
    ['字符串', '1,2,3'],
  ])('%s → 拒绝', (_label, raw) => {
    const result = parseBatchItems(raw)
    expect(result.ok).toBe(false)
  })

  it('空数组 → 拒绝（没有可执行的条目）', () => {
    const result = parseBatchItems([])
    expect(result).toEqual({ ok: false, error: '请至少选择一条记录' })
  })

  it('超过上限 → 拒绝，文案带上限', () => {
    const raw = Array.from({ length: BATCH_ACTION_MAX_ITEMS + 1 }, (_, i) => ({ id: i + 1 }))
    const result = parseBatchItems(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(String(BATCH_ACTION_MAX_ITEMS))
  })

  it('上限按原始条数算，不按去重后算（防止塞超大请求体）', () => {
    const raw = Array.from({ length: BATCH_ACTION_MAX_ITEMS + 1 }, () => ({ id: 1 }))
    expect(parseBatchItems(raw).ok).toBe(false)
  })

  it.each([
    ['0', 0],
    ['负数', -3],
    ['小数', 1.5],
    ['NaN', Number.NaN],
    ['非数字字符串', 'abc'],
    ['带小数的字符串', '1.5'],
    ['空字符串', ''],
    ['对象', { id: 1 }],
    ['缺失', undefined],
  ])('id 为%s → 拒绝', (_label, id) => {
    expect(parseBatchItems([{ id }]).ok).toBe(false)
  })

  it.each([
    ['字符串', '3'],
    ['小数', 2.5],
    ['负数', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('版本号为%s → 拒绝（会被原样当 expectedVersion 比较）', (_label, expectedVersion) => {
    expect(parseBatchItems([{ id: 1, expectedVersion }]).ok).toBe(false)
  })

  it('条目不是对象 → 拒绝', () => {
    expect(parseBatchItems([1, 2]).ok).toBe(false)
  })
})

describe('summarizeBatchResults', () => {
  it('按 ok 分别计数', () => {
    const results: BatchItemResult[] = [
      { id: 1, ok: true },
      { id: 2, ok: false, error: '房源不存在' },
      { id: 3, ok: true },
    ]
    expect(summarizeBatchResults(results)).toEqual({ succeeded: 2, failed: 1 })
  })

  it('空结果计零', () => {
    expect(summarizeBatchResults([])).toEqual({ succeeded: 0, failed: 0 })
  })
})

describe('batchFailureFromError', () => {
  it('业务可预期错误（isPublic）原样给出文案与错误码', () => {
    const err = new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_BUILDING_CITY',
      message: '所选城市不可用',
    })
    expect(batchFailureFromError(7, err)).toEqual({
      id: 7,
      ok: false,
      error: '所选城市不可用',
      code: 'INVALID_BUILDING_CITY',
    })
  })

  it('Payload 自己标了 isPublic 的错误（如校验错误）也给出文案', () => {
    const err = Object.assign(new Error('字段校验失败'), { isPublic: true })
    expect(batchFailureFromError(3, err)).toEqual({ id: 3, ok: false, error: '字段校验失败' })
  })

  it('系统异常不外泄原文（可能含连接串、表结构）', () => {
    const result = batchFailureFromError(1, new Error('connect ECONNREFUSED 10.0.0.1:5432'))
    expect(result).toEqual({ id: 1, ok: false, error: '写入失败，请重试' })
  })

  it('isOperational:false 的领域错误同样不外泄', () => {
    const result = batchFailureFromError(2, new TransactionAbortedError({ operation: 'x' }))
    expect(result).toEqual({ id: 2, ok: false, error: '写入失败，请重试' })
  })

  it('非 Error 抛出物也能收口', () => {
    expect(batchFailureFromError(9, 'boom')).toEqual({ id: 9, ok: false, error: '写入失败，请重试' })
  })
})

describe('partitionForBatch（列表侧预筛）', () => {
  type Row = { id: number; version: number | null; status: string }
  const rows: Row[] = [
    { id: 1, version: 3, status: 'draft' },
    { id: 2, version: null, status: 'published' },
    { id: 3, version: 1, status: 'unpublished' },
  ]

  it('不适用的行带原因进 skipped，其余转成带版本号的条目', () => {
    const result = partitionForBatch(rows, (row) =>
      row.status === 'published' ? '当前状态「已发布」不能上架' : null,
    )
    expect(result.items).toEqual([
      { id: 1, expectedVersion: 3 },
      { id: 3, expectedVersion: 1 },
    ])
    expect(result.skipped).toEqual([{ row: rows[1], reason: '当前状态「已发布」不能上架' }])
  })

  it('全部不适用 → items 为空', () => {
    const result = partitionForBatch(rows, () => '不适用')
    expect(result.items).toEqual([])
    expect(result.skipped).toHaveLength(3)
  })
})

describe('parseBatchResponse（客户端收口端点响应）', () => {
  it('合法响应原样收下', () => {
    const raw = {
      ok: true,
      action: 'publish',
      succeeded: 1,
      failed: 1,
      results: [
        { id: 1, ok: true, status: 'published' },
        { id: 2, ok: false, error: '房源不满足有效供给条件', reasons: ['NO_SUPPLY_MERCHANT'] },
      ],
    }
    expect(parseBatchResponse(raw)).toEqual({
      succeeded: 1,
      failed: 1,
      results: [
        { id: 1, ok: true, status: 'published' },
        { id: 2, ok: false, error: '房源不满足有效供给条件', reasons: ['NO_SUPPLY_MERCHANT'] },
      ],
    })
  })

  it('计数以 results 为准，不信响应里的数字', () => {
    const parsed = parseBatchResponse({
      ok: true,
      succeeded: 99,
      failed: 0,
      results: [{ id: 1, ok: false, error: 'x' }],
    })
    expect(parsed).toMatchObject({ succeeded: 0, failed: 1 })
  })

  it('失败条目缺 error 时给通用文案；reasons 里非字符串丢弃', () => {
    const parsed = parseBatchResponse({
      ok: true,
      results: [{ id: 5, ok: false, code: 'X', reasons: ['A', 3, null] }],
    })
    expect(parsed?.results[0]).toEqual({ id: 5, ok: false, error: '操作失败', code: 'X', reasons: ['A'] })
  })

  it.each([
    ['null', null],
    ['ok 不是 true', { ok: false, error: '权限不足' }],
    ['没有 results', { ok: true }],
    ['results 不是数组', { ok: true, results: {} }],
    ['条目缺 id', { ok: true, results: [{ ok: true }] }],
  ])('%s → null', (_label, raw) => {
    expect(parseBatchResponse(raw)).toBeNull()
  })
})

/**
 * OPT-114：列表单页可到 500 条，而端点单次上限仍是 100。
 * 弹层把条目切成 ≤100 的批次串行发送；下面两组覆盖切片与执行编排。
 */

function makeItems(count: number): BatchItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, expectedVersion: 1 }))
}

describe('chunkBatchItems（OPT-114 分批切片）', () => {
  it('空数组 → 没有批次', () => {
    expect(chunkBatchItems([], 100)).toEqual([])
  })

  it('恰好一批的条数 → 一批', () => {
    expect(chunkBatchItems(makeItems(100), 100)).toHaveLength(1)
  })

  it('多出一条 → 第二批只有一条', () => {
    expect(chunkBatchItems(makeItems(101), 100).map((c) => c.length)).toEqual([100, 1])
  })

  it('490 条 → 100×4 + 90，且拼回去与原顺序一致', () => {
    const items = makeItems(490)
    const chunks = chunkBatchItems(items, 100)
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 100, 100, 90])
    expect(chunks.flat()).toEqual(items)
  })

  it('缺省批大小 = 端点单次上限', () => {
    const chunks = chunkBatchItems(makeItems(BATCH_ACTION_MAX_ITEMS + 1))
    expect(chunks[0]).toHaveLength(BATCH_ACTION_MAX_ITEMS)
  })

  it.each([0, -1, 1.5, Number.NaN])('批大小 %s 不是正整数 → 抛错（防死循环）', (size) => {
    expect(() => chunkBatchItems(makeItems(3), size)).toThrow(RangeError)
  })
})

/** 一批全成功的响应：每条 ok。 */
function allOk(chunk: readonly BatchItem[]): ChunkSendResult {
  const results: BatchItemResult[] = chunk.map((item) => ({ id: item.id, ok: true }))
  return { ok: true, response: { succeeded: results.length, failed: 0, results } }
}

describe('runChunkedBatch（OPT-114 串行分批执行）', () => {
  it('全部成功：逐批发送、结果按序合并、没有中止', async () => {
    const sent: number[] = []
    const outcome = await runChunkedBatch({
      items: makeItems(490),
      chunkSize: 100,
      send: async (chunk) => {
        sent.push(chunk.length)
        return allOk(chunk)
      },
    })
    expect(sent).toEqual([100, 100, 100, 100, 90])
    expect(outcome.results.map((r) => r.id)).toEqual(makeItems(490).map((i) => i.id))
    expect(outcome).toMatchObject({ succeeded: 490, failed: 0, stopped: null })
  })

  it('串行：上一批返回前不发下一批（并发会同时占住多条连接）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await runChunkedBatch({
      items: makeItems(250),
      chunkSize: 100,
      send: async (chunk) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return allOk(chunk)
      },
    })
    expect(maxInFlight).toBe(1)
  })

  it('批内有条目失败不算中止：继续发下一批，失败计入 failed', async () => {
    const outcome = await runChunkedBatch({
      items: makeItems(150),
      chunkSize: 100,
      send: async (chunk) => {
        const results: BatchItemResult[] = chunk.map((item) =>
          item.id === 7 ? { id: 7, ok: false, error: '已被他人修改' } : { id: item.id, ok: true },
        )
        return { ok: true, response: { succeeded: 0, failed: 0, results } }
      },
    })
    expect(outcome).toMatchObject({ succeeded: 149, failed: 1, stopped: null })
    expect(outcome.results).toHaveLength(150)
  })

  it('某批请求失败即停：不再发后续批次，剩余条数含失败那一批', async () => {
    let calls = 0
    const outcome = await runChunkedBatch({
      items: makeItems(490),
      chunkSize: 100,
      send: async (chunk) => {
        calls += 1
        if (calls === 3) return { ok: false, error: '操作失败（HTTP 500）', uncertain: true }
        return allOk(chunk)
      },
    })
    expect(calls).toBe(3)
    expect(outcome.results).toHaveLength(200)
    expect(outcome).toMatchObject({
      succeeded: 200,
      failed: 0,
      stopped: { remaining: 290, error: '操作失败（HTTP 500）', uncertain: true },
    })
  })

  it('第一批就失败：没有任何结果，剩余 = 全部', async () => {
    const outcome = await runChunkedBatch({
      items: makeItems(30),
      chunkSize: 100,
      send: async () => ({ ok: false, error: '没有执行该操作的权限', uncertain: false }),
    })
    expect(outcome).toEqual({
      results: [],
      succeeded: 0,
      failed: 0,
      stopped: { remaining: 30, error: '没有执行该操作的权限', uncertain: false },
    })
  })

  it('进度按已返回的批次累计；失败那一批不计入', async () => {
    const progress: Array<[number, number]> = []
    let calls = 0
    await runChunkedBatch({
      items: makeItems(490),
      chunkSize: 100,
      send: async (chunk) => {
        calls += 1
        if (calls === 5) return { ok: false, error: '网络异常', uncertain: true }
        return allOk(chunk)
      },
      onProgress: (processed, total) => progress.push([processed, total]),
    })
    expect(progress).toEqual([
      [100, 490],
      [200, 490],
      [300, 490],
      [400, 490],
    ])
  })

  it('没有条目：不发请求', async () => {
    let calls = 0
    const outcome = await runChunkedBatch({
      items: [],
      send: async (chunk) => {
        calls += 1
        return allOk(chunk)
      },
    })
    expect(calls).toBe(0)
    expect(outcome).toEqual({ results: [], succeeded: 0, failed: 0, stopped: null })
  })
})
