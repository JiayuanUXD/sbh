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

// Mock req：提供 payload.find 供 slug 唯一性检查使用（返回空 = 无冲突）
const mockReq = {
  payload: {
    find: async () => ({ totalDocs: 0, docs: [] }),
  },
} as never

const create = (data: Record<string, unknown>) =>
  protectListing({ operation: 'create', originalDoc: undefined, data, req: mockReq } as never) as Promise<
    Record<string, unknown>
  >

const runListingProtect = (data: Record<string, unknown>) => create(data)

const update = (data: Record<string, unknown>, originalDoc: Record<string, unknown>) =>
  protectListing({ operation: 'update', originalDoc, data, req: mockReq } as never) as Promise<
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
      slug: 'existing-slug',
      reviewStatus: 'not_submitted',
      publicationStatus: 'draft',
      supplyVisibilityHold: 'normal',
    })
    expect(out.reviewStatus).toBe('not_submitted')
    expect(out.version).toBe(1)
  })
})

describe('listing-protect/枚举二次校验', () => {
  it('拒绝非法得房率和反向工位区间', async () => {
    await expect(
      runListingProtect({
        spaceDetails: { efficiencyRate: 101, seatMin: 30, seatMax: 20 },
      }),
    ).rejects.toThrow('得房率必须在 0–100 之间')
  })

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
    const out = await create({ businessType: 'lease', decorationStatus: 'fully_fitted', slug: 's1' })
    expect(out.businessType).toBe('lease')
    expect(out.decorationStatus).toBe('fully_fitted')
  })
})

describe('listing-protect/版本乐观锁', () => {
  it('提交旧版本 → VERSION_CONFLICT', async () => {
    await expect(update({ version: 2, slug: 's' }, { version: 5, slug: 's' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    })
  })

  it('版本一致 → 自增', async () => {
    const out = await update({ version: 5, slug: 's' }, { version: 5, slug: 's' })
    expect(out.version).toBe(6)
  })

  it('update 未提交 version → 按当前版本自增', async () => {
    const out = await update({ title: '改名', slug: 'existing-slug' }, { version: 3, slug: 'existing-slug' })
    expect(out.version).toBe(4)
  })

  it('update 不重置三轴状态', async () => {
    const out = await update(
      { title: '改名', slug: 'existing-slug' },
      { version: 1, slug: 'existing-slug', reviewStatus: 'approved', publicationStatus: 'published' },
    )
    expect(out.reviewStatus).toBeUndefined()
    expect(out.publicationStatus).toBeUndefined()
  })
})

/**
 * slug 自动生成分支。
 *
 * 补这组的原因：OPT-032 把「URL 标识」从表单里撤下（改 admin.condition: () => false），
 * 提交的 slug 恒为空，自动生成从「几乎不走」变成**每次新建的必经之路**。
 * 原有用例虽然会顺带执行到这段（如 create({ title: '房源A' })），但从不断言结果，
 * 且 mock 的 payload.find 恒返回 0 冲突 —— ensureUniqueSlug 的去重分支一次都没跑过。
 */
describe('listing-protect/slug 自动生成', () => {
  /** 可配置冲突的 req：occupied 里的候选视为已被占用，用于驱动 ensureUniqueSlug 去重。 */
  const reqWithOccupied = (occupied: readonly string[], spy?: (where: unknown) => void) =>
    ({
      payload: {
        find: async ({ where }: { where: { slug: { equals: string } } }) => {
          spy?.(where)
          return { totalDocs: occupied.includes(where.slug.equals) ? 1 : 0, docs: [] }
        },
      },
    }) as never

  const createWith = (data: Record<string, unknown>, req: never) =>
    protectListing({ operation: 'create', originalDoc: undefined, data, req } as never) as Promise<
      Record<string, unknown>
    >

  const updateWith = (
    data: Record<string, unknown>,
    originalDoc: Record<string, unknown>,
    req: never,
  ) =>
    protectListing({ operation: 'update', originalDoc, data, req } as never) as Promise<
      Record<string, unknown>
    >

  it('留空时按标题生成拼音 slug', async () => {
    const out = await createWith({ title: '静安中心 100㎡ 精装办公室' }, reqWithOccupied([]))
    expect(out.slug).toBe('jing-an-zhong-xin-100-jing-zhuang-ban-gong-shi')
  })

  it('slug 冲突时追加 -2', async () => {
    const out = await createWith({ title: '创科大厦' }, reqWithOccupied(['chuang-ke-da-sha']))
    expect(out.slug).toBe('chuang-ke-da-sha-2')
  })

  it('连续冲突时继续递增到 -3', async () => {
    const out = await createWith(
      { title: '创科大厦' },
      reqWithOccupied(['chuang-ke-da-sha', 'chuang-ke-da-sha-2']),
    )
    expect(out.slug).toBe('chuang-ke-da-sha-3')
  })

  it('手工填写的 slug 不被覆盖', async () => {
    const out = await createWith({ title: '创科大厦', slug: 'my-custom' }, reqWithOccupied([]))
    expect(out.slug).toBe('my-custom')
  })

  it('update 时标题改了但原 slug 已存在，保留原 slug（URL 不因改名而变）', async () => {
    const out = await updateWith(
      { title: '改名后的房源', version: 3 },
      { version: 3, slug: 'yuan-lai-de-slug' },
      reqWithOccupied([]),
    )
    expect(out.slug).toBe('yuan-lai-de-slug')
  })

  it('update 生成新 slug 时唯一性检查排除自身 id', async () => {
    const seen: unknown[] = []
    await updateWith(
      { title: '创科大厦', version: 3 },
      { id: 42, version: 3 },
      reqWithOccupied([], (where) => seen.push(where)),
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ id: { not_equals: '42' } })
  })

  it('标题不含可转写字符时兜底，不把 slug 落空', async () => {
    // slugify('###') / emoji 标题都会返回空串；若不兜底，slug 不会被赋值，
    // 最终撞 listings.slug 的 NOT NULL 约束报原始 Postgres 错，而不是友好校验错误。
    // 这条在 OPT-032 之前不致命（字段可见且 required 会先拦），撤下字段后就是唯一防线。
    const out = await createWith({ title: '###' }, reqWithOccupied([]))
    expect(out.slug).toBeTruthy()
    expect(String(out.slug)).toMatch(/^[a-z0-9-]+$/)
  })

  it('兜底 slug 同样参与去重', async () => {
    const out = await createWith({ title: '🏢🏢' }, reqWithOccupied(['listing']))
    expect(out.slug).toBe('listing-2')
  })
})
