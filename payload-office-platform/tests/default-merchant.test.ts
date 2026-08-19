import { describe, expect, it, vi } from 'vitest'

import { Listings } from '@/collections/Listings'
import { BuildingMerchantRelations } from '@/collections/BuildingMerchantRelations'
import {
  getDefaultSupplyMerchantName,
  pickDefaultMerchant,
  resolveDefaultSupplyMerchant,
} from '@/domain/supply/default-merchant'

/**
 * 新建表单默认供给商户。
 *
 * 每条用例对应一个会让默认值「看起来работает、实际有害」的走法：
 *   1. 预选到停用/资质失效商户 → 完整度绿了、前台仍排除（§9），比不预选更误导；
 *   2. 查库异常没兜住 → 整个新建表单加载失败，为了个便利功能把主流程搞挂；
 *   3. 硬编码 id → 换环境后预选到不存在或错误的商户。
 */

const okMerchant = { id: 1, name: '官网', status: 'active', qualificationStatus: 'valid' }

describe('default-merchant/名称解析', () => {
  it('缺省为「官网」', () => {
    expect(getDefaultSupplyMerchantName({})).toBe('官网')
  })

  it('可用 DEFAULT_SUPPLY_MERCHANT_NAME 覆盖（跨环境可移植，不硬编码 id）', () => {
    expect(getDefaultSupplyMerchantName({ DEFAULT_SUPPLY_MERCHANT_NAME: '测试渠道' })).toBe('测试渠道')
  })

  it('空串/纯空白视为未设置，回落缺省', () => {
    expect(getDefaultSupplyMerchantName({ DEFAULT_SUPPLY_MERCHANT_NAME: '   ' })).toBe('官网')
  })
})

describe('default-merchant/pickDefaultMerchant', () => {
  it('挑出合格商户的 id', () => {
    expect(pickDefaultMerchant([okMerchant])).toBe(1)
  })

  it('停用商户不选——预选一个前台会排除的商户比不预选更糟', () => {
    expect(pickDefaultMerchant([{ ...okMerchant, status: 'disabled' }])).toBeNull()
  })

  it('资质失效不选', () => {
    expect(pickDefaultMerchant([{ ...okMerchant, qualificationStatus: 'expired' }])).toBeNull()
  })

  it('跳过不合格的，取第一个合格的', () => {
    const picked = pickDefaultMerchant([
      { ...okMerchant, id: 9, status: 'disabled' },
      { ...okMerchant, id: 31 },
    ])
    expect(picked).toBe(31)
  })

  it('无候选返回 null', () => {
    expect(pickDefaultMerchant([])).toBeNull()
  })
})

describe('default-merchant/resolveDefaultSupplyMerchant', () => {
  it('按名称 + 启用 + 资质有效三条件查询', async () => {
    const find = vi.fn(async () => ({ docs: [okMerchant] }))
    const id = await resolveDefaultSupplyMerchant({ find }, undefined, {})
    expect(id).toBe(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'merchants',
        where: {
          name: { equals: '官网' },
          status: { equals: 'active' },
          qualificationStatus: { equals: 'valid' },
        },
        overrideAccess: true,
      }),
    )
  })

  it('查不到时返回 undefined（不给默认值），而不是抛错', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    await expect(resolveDefaultSupplyMerchant({ find }, undefined, {})).resolves.toBeUndefined()
  })

  it('查库抛错必须吞掉——默认值不能让新建表单加载失败', async () => {
    const find = vi.fn(async () => { throw new Error('db down') })
    await expect(resolveDefaultSupplyMerchant({ find }, undefined, {})).resolves.toBeUndefined()
  })
})

describe('default-merchant/接线', () => {
  const findField = (fields: unknown, name: string): Record<string, unknown> | null => {
    if (!Array.isArray(fields)) return null
    for (const raw of fields) {
      const node = raw as Record<string, unknown>
      if (node?.name === name) return node
      const nested = findField(node?.fields, name) ?? findField(node?.tabs, name)
      if (nested) return nested
    }
    return null
  }

  it('Listings.merchant 挂了 defaultValue 函数', () => {
    expect(typeof findField(Listings.fields, 'merchant')?.defaultValue).toBe('function')
  })

  it('BuildingMerchantRelations.merchant 挂了 defaultValue 函数', () => {
    expect(typeof findField(BuildingMerchantRelations.fields, 'merchant')?.defaultValue).toBe('function')
  })

  it('ListingMerchantRelations.merchant 刻意不挂——留空是「继承楼盘默认商户」的语义', async () => {
    const { ListingMerchantRelations } = await import('@/collections/ListingMerchantRelations')
    expect(findField(ListingMerchantRelations.fields, 'merchant')?.defaultValue).toBeUndefined()
  })
})
