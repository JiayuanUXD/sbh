import { describe, expect, it } from 'vitest'

import { protectMerchant } from '@/domain/supply/merchant-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M2.4 商户保护 hook 单测（design §3.3 / R2）
 * 内存节点图 + mock findByID（服务城市校验）。
 */
type Node = { id: number; type: string; status?: string }

/**
 * 上海(1,city,active) 北京(2,city,active) 广州(3,city,disabled)
 * 浦东(4,district,active)
 */
const GRAPH: Node[] = [
  { id: 1, type: 'city', status: 'active' },
  { id: 2, type: 'city', status: 'active' },
  { id: 3, type: 'city', status: 'disabled' },
  { id: 4, type: 'district', status: 'active' },
]

function makeReq(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    payload: {
      findByID: async ({ id }: { id: number | string }) => {
        const n = byId.get(Number(id))
        if (!n) throw new Error('not found')
        return { id: n.id, type: n.type, status: n.status }
      },
    },
  } as never
}

const create = (data: Record<string, unknown>) =>
  protectMerchant({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(GRAPH),
    data,
  } as never) as Promise<Record<string, unknown>>

describe('merchant-protect/类型与电话', () => {
  it('非法类型 → INVALID_MERCHANT_TYPE', async () => {
    await expect(create({ type: 'LANDLORD' })).rejects.toMatchObject({
      code: 'INVALID_MERCHANT_TYPE',
    })
  })

  it('非法手机号 → INVALID_CONTACT_PHONE', async () => {
    await expect(create({ type: 'OWNER', contactPhone: '12345' })).rejects.toMatchObject({
      code: 'INVALID_CONTACT_PHONE',
    })
  })

  it('合法手机号规范化写回（去 +86/横线）', async () => {
    const out = await create({ type: 'OWNER', contactPhone: '+86 138-0000-1111' })
    expect(out.contactPhone).toBe('13800001111')
  })

  it('空电话不触发校验', async () => {
    const out = await create({ type: 'OWNER', contactPhone: '  ' })
    expect(out.version).toBe(1)
  })
})

describe('merchant-protect/服务城市', () => {
  it('启用城市 → 通过', async () => {
    const out = await create({ type: 'AGENCY', serviceCities: [1, 2] })
    expect(out.version).toBe(1)
  })

  it('非城市节点 → INVALID_SERVICE_CITY', async () => {
    await expect(create({ type: 'AGENCY', serviceCities: [4] })).rejects.toMatchObject({
      code: 'INVALID_SERVICE_CITY',
    })
  })

  it('停用城市 → INVALID_SERVICE_CITY', async () => {
    await expect(create({ type: 'AGENCY', serviceCities: [3] })).rejects.toMatchObject({
      code: 'INVALID_SERVICE_CITY',
    })
  })

  it('不存在城市 → INVALID_SERVICE_CITY，details 列出 id', async () => {
    try {
      await create({ type: 'AGENCY', serviceCities: [999] })
      expect.unreachable('应抛 INVALID_SERVICE_CITY')
    } catch (err) {
      const e = err as DomainError
      expect((e.details as { invalidCities: number[] }).invalidCities).toContain(999)
    }
  })
})

describe('merchant-protect/资质一致性', () => {
  it('valid 缺到期日 → QUALIFICATION_EXPIRY_REQUIRED', async () => {
    await expect(
      create({ type: 'OWNER', qualificationStatus: 'valid' }),
    ).rejects.toMatchObject({ code: 'QUALIFICATION_EXPIRY_REQUIRED' })
  })

  it('valid 且有到期日 → 通过', async () => {
    const out = await create({
      type: 'OWNER',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2026-12-31T00:00:00Z',
    })
    expect(out.version).toBe(1)
  })

  it('非法到期日 → INVALID_QUALIFICATION_EXPIRY', async () => {
    await expect(
      create({ type: 'OWNER', qualificationExpiresAt: 'not-a-date' }),
    ).rejects.toMatchObject({ code: 'INVALID_QUALIFICATION_EXPIRY' })
  })

  it('pending 无到期日 → 通过', async () => {
    const out = await create({ type: 'OWNER', qualificationStatus: 'pending' })
    expect(out.version).toBe(1)
  })
})

describe('merchant-protect/版本乐观锁', () => {
  it('create → version=1', async () => {
    const out = await create({ type: 'OWNER' })
    expect(out.version).toBe(1)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectMerchant({
        operation: 'update',
        originalDoc: { id: 10, type: 'OWNER', version: 5, status: 'active' },
        req: makeReq(GRAPH),
        data: { type: 'OWNER', version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('update 版本一致 → 自增', async () => {
    const out = (await protectMerchant({
      operation: 'update',
      originalDoc: { id: 10, type: 'OWNER', version: 5, status: 'active' },
      req: makeReq(GRAPH),
      data: { type: 'OWNER', version: 5 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(6)
  })
})
