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

/** 带 D2 标识与服务城市的平台自营商户（serviceCities 已 depth:1 展开）。 */
const platformMerchant = {
  ...okMerchant,
  isPlatformDefault: true,
  serviceCities: [{ id: 1, name: '上海' }],
}

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

  // ── §10 服务城市覆盖（OPT-045 §5.1）───────────────────────────────
  // 不判这条的后果不是「没默认值」，而是把 404 换个地方发生：房源 published、
  // merchant 也填上了，前台照样看不见，只是原因码从 §8 变成 §10。

  it('传 cityId 时要求 serviceCities 覆盖它', () => {
    expect(pickDefaultMerchant([platformMerchant], 1)).toBe(1)
    expect(pickDefaultMerchant([platformMerchant], 99)).toBeNull()
  })

  it('cityId 为 null/undefined 时跳过城市判定（后台表单默认值的旧行为）', () => {
    expect(pickDefaultMerchant([platformMerchant], null)).toBe(1)
    expect(pickDefaultMerchant([platformMerchant])).toBe(1)
  })

  it('serviceCities 缺失或未展开一律视为不覆盖，不放行', () => {
    expect(pickDefaultMerchant([{ ...okMerchant }], 1)).toBeNull()
    expect(pickDefaultMerchant([{ ...okMerchant, serviceCities: 'nonsense' }], 1)).toBeNull()
  })

  it('serviceCities 是裸 id 数组（depth:0）时也能比对', () => {
    expect(pickDefaultMerchant([{ ...okMerchant, serviceCities: [1, 2] }], 1)).toBe(1)
  })

  it('id 跨类型比对：字符串 "1" 与数字 1 视为同一城市', () => {
    expect(pickDefaultMerchant([{ ...okMerchant, serviceCities: ['1'] }], 1)).toBe(1)
  })

  it('多个平台自营商户时挑覆盖目标城市的那个（D3 七城各一个）', () => {
    const shanghai = { ...platformMerchant, id: 1, serviceCities: [{ id: 1 }] }
    const hangzhou = { ...platformMerchant, id: 7, serviceCities: [{ id: 7 }] }
    expect(pickDefaultMerchant([shanghai, hangzhou], 7)).toBe(7)
  })
})

describe('default-merchant/resolveDefaultSupplyMerchant', () => {
  it('优先按 isPlatformDefault + 启用 + 资质有效查询（D2：不再按名称约定）', async () => {
    const find = vi.fn(async () => ({ docs: [platformMerchant] }))
    const id = await resolveDefaultSupplyMerchant({ find }, undefined, {})
    expect(id).toBe(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'merchants',
        where: {
          status: { equals: 'active' },
          qualificationStatus: { equals: 'valid' },
          isPlatformDefault: { equals: true },
        },
        // depth:1 让 serviceCities 展开，否则 §10 判定拿不到城市 id
        depth: 1,
        overrideAccess: true,
      }),
    )
    // 命中标记就不该再走名称回落
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('一个 isPlatformDefault 商户都没有时，才按名称回落（旧环境过渡）', async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [okMerchant] })
    const id = await resolveDefaultSupplyMerchant({ find }, undefined, {})
    expect(id).toBe(1)
    expect(find).toHaveBeenCalledTimes(2)
    expect(find).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: { equals: '官网' } }) }),
    )
  })

  it('已有 isPlatformDefault 商户但都不覆盖该城市 → 不走名称回落，直接 undefined', async () => {
    // 这是真实的配置缺口（该城市漏建平台自营商户），用名称路径掩盖它只会让
    // 房源导进来、前台隐身——原因码从 §8 变成 §10，症状更难查。
    const find = vi.fn(async () => ({ docs: [platformMerchant] }))
    const id = await resolveDefaultSupplyMerchant({ find }, { cityId: 99 })
    expect(id).toBeUndefined()
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('传 cityId 时按 §10 过滤：覆盖则命中', async () => {
    const find = vi.fn(async () => ({ docs: [platformMerchant] }))
    await expect(resolveDefaultSupplyMerchant({ find }, { cityId: 1 })).resolves.toBe(1)
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

  // 原有一条断言 ListingMerchantRelations.merchant 刻意不挂 defaultValue
  // （留空 = 继承楼盘默认商户）。OPT-034 已删除该 collection 与其整张关系表，
  // 「继承」语义随之消失，该用例作废。房源侧的供给商户现在直接存在
  // listings.merchant，已由上面第一条断言覆盖。
})
