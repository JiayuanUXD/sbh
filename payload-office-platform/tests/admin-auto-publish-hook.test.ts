import { describe, expect, it, vi } from 'vitest'

import { adminAutoPublish, recordAdminAutoPublish } from '@/domain/review/admin-auto-publish-hook'

/**
 * 平台管理员保存即发布的**接线**（OPT-033 C）。
 *
 * 判定逻辑另有单测（admin-auto-publish.test.ts）；这组守的是接线本身，
 * 因为它是整个改动里唯一会「自动把房源推上公开站」的代码：
 *   - 非管理员保存时两轴必须纹丝不动；
 *   - 不达标时不上架、且不抛错（保存要照常成功）；
 *   - 上架时必须留下带操作人的 fast_track 审核记录——没有操作人就等于没有审计。
 */

vi.mock('@/domain/auth/access', () => ({
  derivePermissionContextFromRequest: vi.fn(),
}))
vi.mock('@/domain/audit/with-audit', () => ({
  withAudit: vi.fn(async (opts: { fn: () => Promise<unknown> }) => opts.fn()),
}))

const { derivePermissionContextFromRequest } = await import('@/domain/auth/access')
const { withAudit } = await import('@/domain/audit/with-audit')

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** 满足提交审核全部必填的租赁房源。 */
const completeListing = {
  id: 42,
  title: '创科大厦 3 层整层办公室',
  slug: 'chuangke-3f',
  building: 12,
  listingType: 'full-floor',
  businessType: 'lease',
  decorationStatus: 'furnished',
  price: { amount: 4.8, currency: 'CNY', period: 'day', unit: 'sqm' },
  area: 1280,
  floor: '3F',
  minimumLeaseMonths: 12,
  paymentTerms: '押二付三',
  availableFrom: '2026-09-01',
  description: '整层可分割',
  contactBroker: 7,
  merchant: 3,
  gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
  reviewStatus: 'not_submitted',
  publicationStatus: 'draft',
  version: 1,
}

const makeReq = () => ({ context: {} as Record<string, unknown>, payload: { create: vi.fn(async () => ({ id: 900 })) } })

const setActor = (roleCodes: string[] | null) => {
  asMock(derivePermissionContextFromRequest).mockResolvedValue(
    roleCodes === null ? null : { userId: 5, roleCodes },
  )
}

const runBefore = (data: Record<string, unknown>, originalDoc: Record<string, unknown> | undefined, req: unknown) =>
  (adminAutoPublish as unknown as (a: unknown) => Promise<Record<string, unknown>>)({
    data,
    originalDoc,
    req,
    operation: 'update',
    collection: undefined,
    context: {},
  })

const runAfter = (doc: Record<string, unknown>, req: unknown) =>
  (recordAdminAutoPublish as unknown as (a: unknown) => Promise<unknown>)({ doc, req, operation: 'update' })

describe('admin-auto-publish-hook/beforeChange', () => {
  it('平台管理员 + 条件齐备 → 两轴一起推到已发布', async () => {
    setActor(['ADM'])
    const req = makeReq()
    const data = await runBefore({ title: '改个标题' }, completeListing, req)
    expect(data.reviewStatus).toBe('approved')
    expect(data.publicationStatus).toBe('published')
    // 标记要置位，afterChange 才知道该补审核记录
    expect(req.context.__opt033AdminAutoPublish).toMatchObject({ userId: 5 })
  })

  it('非管理员保存 → 两轴纹丝不动', async () => {
    setActor(['OPS'])
    const req = makeReq()
    const data = await runBefore({ title: '改个标题' }, completeListing, req)
    expect(data.reviewStatus).toBeUndefined()
    expect(data.publicationStatus).toBeUndefined()
    expect(req.context.__opt033AdminAutoPublish).toBeUndefined()
  })

  it('未登录（无上下文）→ 不动，也不抛错', async () => {
    setActor(null)
    const req = makeReq()
    const data = await runBefore({ title: 'x' }, completeListing, req)
    expect(data.publicationStatus).toBeUndefined()
  })

  it('图片不足 → 照常保存为草稿，不上架、不抛错', async () => {
    setActor(['ADM'])
    const req = makeReq()
    const data = await runBefore({ title: 'x' }, { ...completeListing, gallery: [{ image: 1 }] }, req)
    expect(data.publicationStatus).toBeUndefined()
    expect(req.context.__opt033AdminAutoPublish).toBeUndefined()
  })

  it('本次保存把审核态改成 pending 时不上架（data 覆盖 originalDoc）', async () => {
    setActor(['ADM'])
    const req = makeReq()
    const data = await runBefore({ reviewStatus: 'pending' }, completeListing, req)
    expect(data.publicationStatus).toBeUndefined()
  })
})

describe('admin-auto-publish-hook/afterChange', () => {
  it('没有标记时什么都不做（普通保存不该产生审核记录）', async () => {
    const req = makeReq()
    await runAfter(completeListing, req)
    expect(req.payload.create).not.toHaveBeenCalled()
    expect(asMock(withAudit)).not.toHaveBeenCalled()
  })

  it('有标记时写一条带操作人的 fast_track 记录', async () => {
    const req = makeReq()
    req.context.__opt033AdminAutoPublish = { userId: 5, before: null }
    await runAfter({ ...completeListing, reviewStatus: 'approved', publicationStatus: 'published' }, req)

    const call = asMock(req.payload.create).mock.calls[0]![0] as {
      collection: string
      data: Record<string, unknown>
    }
    expect(call.collection).toBe('listing-reviews')
    expect(call.data.decision).toBe('fast_track')
    // 操作人是这条记录存在的全部意义——历史缺陷正是这里恒为 undefined
    expect(call.data.reviewedBy).toBe(5)
    expect(call.data.taskStatus).toBe('resolved')
    expect(call.data.listing).toBe(42)

    // 审计动作要与人工审核区分开
    expect(asMock(withAudit).mock.calls[0]![0].action).toBe('listing.review_fast_track')
  })

  it('标记消费后即清除，同一请求的二次 afterChange 不重复记账', async () => {
    const req = makeReq()
    req.context.__opt033AdminAutoPublish = { userId: 5, before: null }
    await runAfter(completeListing, req)
    await runAfter(completeListing, req)
    expect(req.payload.create).toHaveBeenCalledTimes(1)
  })
})
