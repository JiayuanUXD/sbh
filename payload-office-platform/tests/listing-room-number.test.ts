import { ValidationError } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { Listings } from '@/collections/Listings'
import { buildListingListConditions } from '@/components/admin/listings-list-conditions'
import {
  assertListingRoomNumberUnique,
  isRoomNumberInput,
  normalizeRoomNumber,
  normalizeListingRoomNumber,
} from '@/domain/review/listing-room-number'
import { mapListingCard, mapListingDetail } from '@/domain/public-catalog/mappers'
import { LISTING_MONTHLY_STANDARD } from '@/test/frontend/payload-documents'

/**
 * 房源「房间号」（OPT-063）。
 *
 * 这里的每一组断言都对应一个**会静默失效**的坑，不是为了覆盖率：
 *
 *   1. 归一化：后台清空文本框提交的是空串不是 null，而 PG 唯一索引里 NULL 互不冲突、
 *      空串却互撞——不归一就会出现「两条都没填房间号的房源不能共存」。
 *   2. 查重带 trash：唯一索引覆盖软删行，查重不同口径就会「hook 放行→数据库拒绝→
 *      用户看到一句看不懂的话」。
 *   3. 字段级权限：本仓库第一处，删掉它不会有任何测试变红，房间号就悄悄进了
 *      /api/listings 的匿名响应。
 *   4. 前台不映射：这是个负向约定，靠「记得别加」必然漂。
 */

type AnyField = Record<string, any>

function walk(nodes: AnyField[], visit: (node: AnyField) => void) {
  for (const node of nodes) {
    visit(node)
    if (Array.isArray(node.fields)) walk(node.fields, visit)
    if (Array.isArray(node.tabs)) walk(node.tabs, visit)
  }
}

function findField(name: string): AnyField | undefined {
  let found: AnyField | undefined
  walk(Listings.fields as AnyField[], (node) => {
    if (node.name === name) found = node
  })
  return found
}

// ---------------------------------------------------------------- 归一化

describe('normalizeRoomNumber', () => {
  it('去掉首尾空白', () => {
    expect(normalizeRoomNumber('  1201  ')).toBe('1201')
  })

  it('空串与纯空白折成 null（否则会互撞唯一索引）', () => {
    expect(normalizeRoomNumber('')).toBeNull()
    expect(normalizeRoomNumber('   ')).toBeNull()
  })

  it('null / undefined 保持 null', () => {
    expect(normalizeRoomNumber(null)).toBeNull()
    expect(normalizeRoomNumber(undefined)).toBeNull()
  })
})

describe('normalizeListingRoomNumber hook', () => {
  it('本次提交带了 roomNumber 才改写', () => {
    const data = { title: 'x', roomNumber: ' 1201 ' }
    expect(normalizeListingRoomNumber({ data } as never)).toMatchObject({ roomNumber: '1201' })
  })

  it('部分更新没带 roomNumber 时原样返回，不会把已有值抹成 null', () => {
    const data = { title: 'x' }
    const out = normalizeListingRoomNumber({ data } as never) as Record<string, unknown>
    expect(out).toBe(data)
    expect('roomNumber' in out).toBe(false)
  })

  /**
   * 非字符串必须拒绝，不能靠 `String(value)` 兜——它会把 `{}` 变成
   * `"[object Object]"`、把 `[12,1]` 变成 `"12,1"`，这些"看着像标识符"的垃圾
   * 会真的占住 (building, roomNumber) 唯一索引。REST / Local API 都能构造。
   */
  it.each([
    ['对象', {}],
    ['数组', [12, 1]],
    ['数字', 1201],
    ['布尔', true],
  ])('拒绝非字符串输入：%s', (_label, value) => {
    expect(() =>
      normalizeListingRoomNumber({ data: { roomNumber: value }, req: {} } as never),
    ).toThrow(ValidationError)
  })

  it('拒绝时报的是 roomNumber 这个字段，文案说得清是类型问题', () => {
    try {
      normalizeListingRoomNumber({ data: { roomNumber: {} }, req: {} } as never)
      expect.unreachable('应当抛出 ValidationError')
    } catch (error) {
      const data = (error as { data?: { errors?: Array<{ path?: string; message?: string }> } }).data
      expect(data?.errors?.[0]?.path).toBe('roomNumber')
      expect(data?.errors?.[0]?.message).toContain('文本')
    }
  })
})

describe('isRoomNumberInput', () => {
  it('放行字符串 / null / undefined', () => {
    expect(isRoomNumberInput('1201')).toBe(true)
    expect(isRoomNumberInput('')).toBe(true)
    expect(isRoomNumberInput(null)).toBe(true)
    expect(isRoomNumberInput(undefined)).toBe(true)
  })

  it('挡住其余一切类型', () => {
    for (const value of [{}, [], 0, 1201, true, false, Symbol('x'), () => {}]) {
      expect(isRoomNumberInput(value), String(String(value))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- 查重

/** 造一个只实现 find 的 req 桩。 */
function makeReq(docs: unknown[]) {
  const find = vi.fn().mockResolvedValue({ docs })
  return { req: { payload: { find } } as never, find }
}

describe('assertListingRoomNumberUnique', () => {
  it('房间号为空时压根不查库', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({
      data: { roomNumber: null, building: 7 },
      req,
    } as never)
    expect(find).not.toHaveBeenCalled()
  })

  it('没有所属楼盘时不查库（「同楼盘内唯一」无从谈起）', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({ data: { roomNumber: '1201' }, req } as never)
    expect(find).not.toHaveBeenCalled()
  })

  it('同楼盘无冲突时放行', async () => {
    const { req, find } = makeReq([])
    const data = { roomNumber: '1201', building: 7 }
    await expect(
      assertListingRoomNumberUnique({ data, req } as never),
    ).resolves.toBe(data)
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('查询必须带 trash: true —— 与唯一索引「软删也占号」同口径', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({
      data: { roomNumber: '1201', building: 7 },
      req,
    } as never)
    expect(find.mock.calls[0][0]).toMatchObject({ collection: 'listings', trash: true })
  })

  it('更新时把自己排除掉，否则改别的字段会被自己挡住', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({
      data: { roomNumber: '1201' },
      originalDoc: { id: 42, building: 7, roomNumber: '1201' },
      req,
    } as never)
    expect(find.mock.calls[0][0].where.and).toContainEqual({ id: { not_equals: 42 } })
  })

  it('只改楼盘、不改房间号，同样要查重（从 originalDoc 取另一半）', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({
      data: { building: 9 },
      originalDoc: { id: 42, building: 7, roomNumber: '1201' },
      req,
    } as never)
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0][0].where.and).toContainEqual({ building: { equals: 9 } })
    expect(find.mock.calls[0][0].where.and).toContainEqual({ roomNumber: { equals: '1201' } })
  })

  it('关系字段已被填充成对象时也能取到 id', async () => {
    const { req, find } = makeReq([])
    await assertListingRoomNumberUnique({
      data: { roomNumber: '1201', building: { id: 7, name: '某大厦' } },
      req,
    } as never)
    expect(find.mock.calls[0][0].where.and).toContainEqual({ building: { equals: 7 } })
  })

  it('撞到未删除的房源：报错带冲突房源标题', async () => {
    const { req } = makeReq([{ id: 99, title: '东郊中心 1201', deletedAt: null }])
    await expect(
      assertListingRoomNumberUnique({
        data: { roomNumber: '1201', building: 7 },
        req,
      } as never),
    ).rejects.toThrow(ValidationError)

    try {
      await assertListingRoomNumberUnique({
        data: { roomNumber: '1201', building: 7 },
        req,
      } as never)
      expect.unreachable('应当抛错')
    } catch (error) {
      const entry = (error as ValidationError).data.errors[0]
      expect(entry.path).toBe('roomNumber')
      expect(entry.message).toContain('东郊中心 1201')
      expect(entry.message).not.toContain('回收站')
    }
  })

  it('撞到软删房源：换一套文案，明确指路回收站', async () => {
    const { req } = makeReq([
      { id: 99, title: '东郊中心 1201', deletedAt: '2026-08-01T00:00:00.000Z' },
    ])
    try {
      await assertListingRoomNumberUnique({
        data: { roomNumber: '1201', building: 7 },
        req,
      } as never)
      expect.unreachable('应当抛错')
    } catch (error) {
      const entry = (error as ValidationError).data.errors[0]
      expect(entry.path).toBe('roomNumber')
      expect(entry.message).toContain('回收站')
      expect(entry.message).toContain('已删除')
      // Payload 把校验消息当纯文本渲染，写 markdown 会原样显示成星号
      expect(entry.message).not.toContain('**')
    }
  })
})

// ---------------------------------------------------------------- collection 配置

describe('Listings 上的 roomNumber 配置', () => {
  const field = findField('roomNumber')

  it('字段存在，且是 text', () => {
    expect(field?.type).toBe('text')
  })

  it('带字段级 access.read：登录可读、匿名不可读', () => {
    // 删掉这段 access 不会让任何别的测试变红，房间号会悄悄进匿名 REST/GraphQL 响应。
    expect(typeof field?.access?.read).toBe('function')
    expect(field?.access?.read({ req: { user: { id: 1 } } })).toBe(true)
    expect(field?.access?.read({ req: {} })).toBe(false)
    expect(field?.access?.read({ req: { user: null } })).toBe(false)
  })

  it('挂了 (building, roomNumber) 的复合唯一索引作为并发兜底', () => {
    expect(Listings.indexes).toContainEqual({
      fields: ['building', 'roomNumber'],
      unique: true,
    })
  })

  it('归一化与查重都挂进了 beforeValidate，且归一在前', () => {
    const hooks = Listings.hooks?.beforeValidate ?? []
    expect(hooks.indexOf(normalizeListingRoomNumber)).toBe(0)
    expect(hooks.indexOf(assertListingRoomNumberUnique)).toBeGreaterThan(0)
  })

  it('不是发布必填项（内部标识，缺它不该拦发布）', () => {
    // markPublishRequired 打的是 custom.publishRequired 标记
    expect(field?.custom?.publishRequired).not.toBe(true)
  })
})

// ---------------------------------------------------------------- 前台负向守卫

describe('前台不暴露房间号', () => {
  // 用一个真实会映射成功的夹具，再塞进房间号——如果 mapper 哪天顺手加了这个字段，
  // 下面两条会直接变红。用不完整的假数据会让 mapper 返回 null，断言变成恒真。
  const listing = { ...LISTING_MONTHLY_STANDARD, roomNumber: 'A-1201' }

  it('mapListingDetail 的产出里既没有 roomNumber 键，也没有它的值', () => {
    const detail = mapListingDetail(listing)
    expect(detail).not.toBeNull()
    expect(JSON.stringify(detail)).not.toContain('A-1201')
    expect(JSON.stringify(detail)).not.toContain('roomNumber')
  })

  it('mapListingCard 同样不带（列表页链路）', () => {
    const card = mapListingCard(listing)
    expect(card).not.toBeNull()
    expect(JSON.stringify(card)).not.toContain('A-1201')
    expect(JSON.stringify(card)).not.toContain('roomNumber')
  })
})

// ---------------------------------------------------------------- 后台搜索

describe('buildListingListConditions', () => {
  const empty = {
    q: null,
    publicationStatus: null,
    reviewStatus: null,
    listingType: null,
    businessType: null,
    building: null,
    missingCover: false,
    pendingRecheck: false,
  } as const

  it('关键词同时搜标题与房间号', () => {
    expect(buildListingListConditions({ ...empty, q: '1201' })).toContainEqual({
      or: [{ title: { like: '1201' } }, { roomNumber: { like: '1201' } }],
    })
  })

  it('没有关键词时不产出搜索条件', () => {
    expect(buildListingListConditions(empty)).toEqual([])
  })

  it('原有筛选不回归', () => {
    const conditions = buildListingListConditions({
      ...empty,
      publicationStatus: 'published',
      building: 7,
      missingCover: true,
      pendingRecheck: true,
    })
    expect(conditions).toContainEqual({ publicationStatus: { equals: 'published' } })
    expect(conditions).toContainEqual({ building: { equals: 7 } })
    expect(conditions).toContainEqual({ coverImage: { exists: false } })
    expect(conditions).toContainEqual({ supplyVisibilityHold: { equals: 'pending_recheck' } })
  })
})
