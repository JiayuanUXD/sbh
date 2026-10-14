import { describe, expect, it } from 'vitest'

import { InvalidOperationError } from '@/domain/shared/errors'
import { TransactionAbortedError } from '@/domain/shared/transaction-safety'
import {
  BATCH_ACTION_MAX_ITEMS,
  batchFailureFromError,
  parseBatchItems,
  parseBatchResponse,
  partitionForBatch,
  summarizeBatchResults,
  type BatchItemResult,
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
