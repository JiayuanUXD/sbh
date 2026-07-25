import { describe, expect, it } from 'vitest'

import { protectListing } from '@/domain/review/listing-protect'

/**
 * M4.1 房源保护 hook 单测（design §3.4 / R4）
 *
 * 守护不变量：
 *   - create 初始化三轴状态（审核 not_submitted / 发布 draft / 供给冻结 normal）+ version=1
 *   - 枚举二次校验（客户端传非法值直接拒绝，防绕过 select）
 *   - 版本乐观锁（update 提交旧 version → 409 VERSION_CONFLICT）
 *   - R3：hook 不隐式改写审核/发布状态（仅在缺省时初始化，不覆盖已有值）
 */

const create = (data: Record<string, unknown>) =>
  protectListing({ operation: 'create', originalDoc: undefined, data } as never) as Promise<
    Record<string, unknown>
  >

const update = (data: Record<string, unknown>, originalDoc: Record<string, unknown>) =>
  protectListing({ operation: 'update', originalDoc, data } as never) as Promise<
    Record<string, unknown>
  >

describe('listing-protect/create 初始化', () => {
  it('缺省三轴状态与版本被初始化', async () => {
    const out = await create({ title: '房源A' })
    expect(out.reviewStatus).toBe('not_submitted')
    expect(out.publicationStatus).toBe('draft')
    expect(out.supplyVisibilityHold).toBe('normal')
    expect(out.version).toBe(1)
  })

  it('create 不覆盖已显式给定的合法状态', async () => {
    const out = await create({
      title: '房源A',
      reviewStatus: 'not_submitted',
      publicationStatus: 'draft',
      supplyVisibilityHold: 'normal',
    })
    expect(out.reviewStatus).toBe('not_submitted')
    expect(out.version).toBe(1)
  })
})

describe('listing-protect/枚举二次校验', () => {
  it('非法 reviewStatus → INVALID_REVIEW_STATUS', async () => {
    await expect(create({ reviewStatus: 'bogus' })).rejects.toMatchObject({
      code: 'INVALID_REVIEW_STATUS',
    })
  })

  it('非法 publicationStatus → INVALID_PUBLICATION_STATUS', async () => {
    await expect(create({ publicationStatus: 'bogus' })).rejects.toMatchObject({
      code: 'INVALID_PUBLICATION_STATUS',
    })
  })

  it('非法 supplyVisibilityHold → INVALID_SUPPLY_VISIBILITY_HOLD', async () => {
    await expect(create({ supplyVisibilityHold: 'frozen' })).rejects.toMatchObject({
      code: 'INVALID_SUPPLY_VISIBILITY_HOLD',
    })
  })

  it('非法 businessType → INVALID_BUSINESS_TYPE', async () => {
    await expect(create({ businessType: 'rent' })).rejects.toMatchObject({
      code: 'INVALID_BUSINESS_TYPE',
    })
  })

  it('非法 decorationStatus → INVALID_DECORATION_STATUS', async () => {
    await expect(create({ decorationStatus: 'luxury' })).rejects.toMatchObject({
      code: 'INVALID_DECORATION_STATUS',
    })
  })

  it('合法可选枚举 create 通过', async () => {
    const out = await create({ businessType: 'lease', decorationStatus: 'fully_fitted' })
    expect(out.businessType).toBe('lease')
    expect(out.decorationStatus).toBe('fully_fitted')
  })
})

describe('listing-protect/版本乐观锁', () => {
  it('提交旧版本 → VERSION_CONFLICT', async () => {
    await expect(update({ version: 2 }, { version: 5 })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    })
  })

  it('版本一致 → 自增', async () => {
    const out = await update({ version: 5 }, { version: 5 })
    expect(out.version).toBe(6)
  })

  it('update 未提交 version → 按当前版本自增', async () => {
    const out = await update({ title: '改名' }, { version: 3 })
    expect(out.version).toBe(4)
  })

  it('update 不重置三轴状态', async () => {
    const out = await update(
      { title: '改名' },
      { version: 1, reviewStatus: 'approved', publicationStatus: 'published' },
    )
    expect(out.reviewStatus).toBeUndefined()
    expect(out.publicationStatus).toBeUndefined()
  })
})
