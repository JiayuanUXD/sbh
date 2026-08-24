import { describe, expect, it } from 'vitest'

import { validateListingRow, LISTING_COLUMNS, type RowContext } from '@/domain/supply-import/listing-row'
import { MERCHANT_RESOLUTION_CODES, type BuildingMerchantRelationInput } from '@/domain/supply-import/resolve-merchant'

const NOW = new Date('2026-08-22T00:00:00.000Z')

/**
 * B-001（id:100）与 B-999（id:200）都配一条当前生效且合格的商户关系——
 * B-999 只是「不在 OPS 可导入城市范围内」的越权样例，不是 D10 的缺商户样例，
 * 两类场景不能共用同一栋楼混着测，否则「越权城市」用例会被商户错误污染 errors[0]。
 * D10 本身的缺商户 / 商户不合格场景在下面单独的 describe 块里用专属 buildingId 覆盖。
 */
const ELIGIBLE_RELATION: BuildingMerchantRelationInput = {
  buildingId: 100,
  merchantId: 500,
  merchantStatus: 'active',
  qualificationStatus: 'valid',
  qualificationExpiresAt: null,
  serviceCityIds: [1],
  effectiveFrom: '2020-01-01T00:00:00.000Z',
  effectiveTo: null,
}

const ELIGIBLE_RELATION_999: BuildingMerchantRelationInput = {
  ...ELIGIBLE_RELATION,
  buildingId: 200,
  merchantId: 600,
  serviceCityIds: [9],
}

const ctx: RowContext = {
  tables: {
    locations: { city: [], district: [], business_area: [], metro_station: [] },
    aliases: { city: new Map(), district: new Map(), business_area: new Map(), metro_station: new Map() },
  },
  buildings: [
    {
      id: 100,
      name: '环球金融中心',
      slug: 'huan-qiu',
      externalId: 'B-001',
      cityId: 1,
      status: 'published',
      operationalStatus: 'active',
      deletedAt: null,
      cityStatus: 'active',
      districtStatus: 'active',
    },
    {
      id: 200,
      name: '外地大厦',
      slug: 'wai-di',
      externalId: 'B-999',
      cityId: 9,
      status: 'published',
      operationalStatus: 'active',
      deletedAt: null,
      cityStatus: 'active',
      districtStatus: 'active',
    },
  ],
  allowedCityIds: new Set([1]),
  buildingMerchantRelations: [ELIGIBLE_RELATION, ELIGIBLE_RELATION_999],
  merchants: [
    {
      id: 77,
      name: '指定商户',
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
      serviceCityIds: [1],
    },
  ],
  now: NOW,
}

// listingType / decorationStatus 的值以 Step 1 抄到的真实枚举为准
// （@/domain/review/listing-fields 的 LISTING_TYPE_LABELS / DECORATION_STATUS_LABELS）
const goodRow = {
  房源编号: 'L-001',
  房源标题: '环球金融中心 280㎡ 精装办公室',
  房源类型: '传统办公室',
  楼盘编号或标识: 'B-001',
  面积: '280㎡',
  租金: '4.5元/㎡/天',
  楼层: '12层',
  装修: '精装带家具',
  可租日期: '2026-09-01',
}

describe('validateListingRow', () => {
  it('模板列头固定且以编号打头', () => {
    expect(LISTING_COLUMNS[0]).toBe('房源编号')
    expect(LISTING_COLUMNS).toContain('楼盘编号或标识')
  })

  it('完整正确行通过并产出规范化值', () => {
    const r = validateListingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      externalId: 'L-001',
      buildingId: 100,
      area: 280,
      rentAmount: 4.5,
      rentUnit: 'rmb-sqm-day',
      floor: 12,
    })
  })

  it('缺编号即错误行——编号是幂等键，不能自动补', () => {
    const r = validateListingRow({ ...goodRow, 房源编号: '  ' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({
      rowNumber: 2, column: '房源编号', code: 'REQUIRED',
    })
  })

  it('租金缺单位即错误行，不猜默认单位', () => {
    const r = validateListingRow({ ...goodRow, 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'RENT_UNIT_UNKNOWN')).toBe(true)
  })

  it('租金写成总价（如「80万」）判为错误行，不能一路通过预检——评审 Task 7 第 1 轮 Important 3', () => {
    const r = validateListingRow({ ...goodRow, 租金: '80万' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'RENT_UNIT_UNSUPPORTED')).toBe(true)
  })

  it('RENT_UNIT_UNKNOWN 的提示不再教运营写会必炸的「万」格式', () => {
    const r = validateListingRow({ ...goodRow, 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    const unknown = r.ok === false && r.errors.find((e) => e.code === 'RENT_UNIT_UNKNOWN')
    expect(unknown && unknown.message).not.toMatch(/万/)
  })

  it('楼盘匹配不到即错误行，绝不自动建楼盘', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: '不存在大厦' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_FOUND')).toBe(true)
  })

  it('越权城市的楼盘判为错误行，而不是静默跳过', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('allowedCityIds 为 all 时不做城市校验', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, { ...ctx, allowedCityIds: 'all' })
    expect(r.ok).toBe(true)
  })

  it('一行的多个问题一次全报出来，不是报一个就停', () => {
    const r = validateListingRow({ ...goodRow, 面积: '待定', 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('房源类型填了不存在的标签即 ENUM_UNKNOWN，message 列出全部合法标签', () => {
    const r = validateListingRow({ ...goodRow, 房源类型: '写字楼' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({ column: '房源类型', code: 'ENUM_UNKNOWN' })
    const message = r.ok === false ? r.errors[0].message : ''
    expect(message).toContain('传统办公室')
    expect(message).toContain('共享办公')
    expect(message).toContain('整层办公')
    expect(message).toContain('服务式办公室')
  })

  // ────────────────────────────────────────────────────────────
  // D10：房源商户继承楼盘当前生效商户（规格 §11）
  // ────────────────────────────────────────────────────────────

  it('楼盘没有生效商户关系 → 错误行，message 指楼盘而不是房源本身', () => {
    const noMerchantCtx: RowContext = { ...ctx, buildingMerchantRelations: [] }
    const r = validateListingRow(goodRow, 2, noMerchantCtx)
    expect(r.ok).toBe(false)
    const err = r.ok === false && r.errors.find((e) => e.code === MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION)
    expect(err).toBeTruthy()
    expect(err && err.message).toContain('楼盘「环球金融中心」')
    expect(err && err.message).toContain('没有生效的供给商户')
  })

  it('楼盘当前生效商户已停用 → 错误行，message 点出是商户不合格', () => {
    const disabledMerchantCtx: RowContext = {
      ...ctx,
      buildingMerchantRelations: [{ ...ELIGIBLE_RELATION, merchantStatus: 'disabled' }],
    }
    const r = validateListingRow(goodRow, 2, disabledMerchantCtx)
    expect(r.ok).toBe(false)
    const err = r.ok === false && r.errors.find((e) => e.code === MERCHANT_RESOLUTION_CODES.MERCHANT_INELIGIBLE)
    expect(err).toBeTruthy()
    expect(err && err.message).toContain('已停用')
  })

  it('楼盘当前生效商户资质已过期 → 错误行，message 点出资质问题', () => {
    const expiredCtx: RowContext = {
      ...ctx,
      buildingMerchantRelations: [
        { ...ELIGIBLE_RELATION, qualificationExpiresAt: '2020-01-01T00:00:00.000Z' },
      ],
    }
    const r = validateListingRow(goodRow, 2, expiredCtx)
    expect(r.ok).toBe(false)
    const err = r.ok === false && r.errors.find((e) => e.code === MERCHANT_RESOLUTION_CODES.MERCHANT_INELIGIBLE)
    expect(err && err.message).toContain('资质无效或已过期')
  })

  it('楼盘商户合格 → 通过预检（商户本身不进 ValidListingRow，写入层从同一来源独立取值）', () => {
    const r = validateListingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
  })

  // ────────────────────────────────────────────────────────────
  // 最终评审 Critical 2：§7 有效供给未校验，导入会命中前台不可见的楼盘
  // ────────────────────────────────────────────────────────────

  it('楼盘是草稿（status !== published）→ 错误行，message 指明是楼盘/区域不可见', () => {
    const draftCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], status: 'draft' }],
    }
    const r = validateListingRow(goodRow, 2, draftCtx)
    expect(r.ok).toBe(false)
    const err = r.ok === false && r.errors.find((e) => e.code === 'BUILDING_NOT_VISIBLE')
    expect(err).toBeTruthy()
    expect(err && err.message).toContain('不是房源本身的问题')
  })

  it('楼盘已归档（status=archived）→ 错误行', () => {
    const archivedCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], status: 'archived' }],
    }
    const r = validateListingRow(goodRow, 2, archivedCtx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_VISIBLE')).toBe(true)
  })

  it('楼盘运营状态已停用（operationalStatus=disabled）→ 错误行', () => {
    const disabledCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], operationalStatus: 'disabled' }],
    }
    const r = validateListingRow(goodRow, 2, disabledCtx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_VISIBLE')).toBe(true)
  })

  it('楼盘已软删（deletedAt 非空）→ 错误行', () => {
    const trashedCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], deletedAt: '2026-08-01T00:00:00.000Z' }],
    }
    const r = validateListingRow(goodRow, 2, trashedCtx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_VISIBLE')).toBe(true)
  })

  it('楼盘所属城市已停用（cityStatus=disabled）→ 错误行', () => {
    const cityDisabledCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], cityStatus: 'disabled' }],
    }
    const r = validateListingRow(goodRow, 2, cityDisabledCtx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_VISIBLE')).toBe(true)
  })

  it('楼盘所属行政区已停用（districtStatus=disabled）→ 错误行', () => {
    const districtDisabledCtx: RowContext = {
      ...ctx,
      buildings: [{ ...ctx.buildings[0], districtStatus: 'disabled' }],
    }
    const r = validateListingRow(goodRow, 2, districtDisabledCtx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_VISIBLE')).toBe(true)
  })

  // ────────────────────────────────────────────────────────────
  // OPT-045 新增六列 + 租金/售价语义变更（§2.4 缺口三：出售类压根导不进来）
  // ────────────────────────────────────────────────────────────

  describe('租金 / 售价（语义变更：不再是租金硬必填）', () => {
    it('租赁行照旧通过，并同时产出结构化价格', () => {
      const r = validateListingRow(goodRow, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value).toMatchObject({
        rentAmount: 4.5,
        rentUnit: 'rmb-sqm-day',
        price: { amount: 4.5, period: 'day', unit: 'sqm' },
        businessType: 'lease',
      })
    })

    it('元/月 → (month, suite)，元/工位/月 → (month, seat)', () => {
      const monthly = validateListingRow({ ...goodRow, 租金: '8000元/月' }, 2, ctx)
      expect(monthly.ok && monthly.value.price).toMatchObject({ period: 'month', unit: 'suite' })
      const seat = validateListingRow({ ...goodRow, 租金: '1500元/工位/月' }, 2, ctx)
      expect(seat.ok && seat.value.price).toMatchObject({ period: 'month', unit: 'seat' })
    })

    it('出售总价：租金留空、售价填「800万」→ (one-time, suite)，旧租金字段为 null', () => {
      const r = validateListingRow({ ...goodRow, 租金: '', 售价: '800万' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value).toMatchObject({
        rentAmount: null,
        rentUnit: null,
        price: { amount: 8000000, period: 'one-time', unit: 'suite' },
        businessType: 'sale',
      })
    })

    it('出售单价：「5.2万元/㎡」→ (one-time, sqm)', () => {
      const r = validateListingRow({ ...goodRow, 租金: '', 售价: '5.2万元/㎡' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.price).toMatchObject({ amount: 52000, period: 'one-time', unit: 'sqm' })
    })

    it('两列都空即错误行 PRICE_REQUIRED', () => {
      const r = validateListingRow({ ...goodRow, 租金: '' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'PRICE_REQUIRED')).toBe(true)
    })

    it('两列都填即错误行 PRICE_AMBIGUOUS，不静默挑一个', () => {
      const r = validateListingRow({ ...goodRow, 售价: '800万' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'PRICE_AMBIGUOUS')).toBe(true)
    })

    it('总价写进租金列 → 文案指向「售价」列，而不是让运营改写法', () => {
      const r = validateListingRow({ ...goodRow, 租金: '80万' }, 2, ctx)
      expect(r.ok).toBe(false)
      const err = r.ok === false && r.errors.find((e) => e.column === '租金')
      expect(err && err.code).toBe('RENT_UNIT_UNSUPPORTED')
      expect(err && err.message).toContain('售价')
    })

    it('租赁写法混进售价列判错误行——当成总价会让价格错四个数量级', () => {
      const r = validateListingRow({ ...goodRow, 租金: '', 售价: '5.2元/㎡/天' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'SALE_PRICE_INVALID')).toBe(true)
    })

    it('售价区间写法判错误行', () => {
      const r = validateListingRow({ ...goodRow, 租金: '', 售价: '800-900万' }, 2, ctx)
      expect(r.ok).toBe(false)
    })
  })

  describe('供给商户列（优先级最高的一级）', () => {
    it('填了就用它，楼盘关系不参与', () => {
      const r = validateListingRow({ ...goodRow, 供给商户: '指定商户' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.merchantId).toBe(77)
    })

    it('留空则 merchantId 为 null，交给「楼盘关系 → 平台自营回落」', () => {
      const r = validateListingRow(goodRow, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.merchantId).toBeNull()
    })

    it('填了不存在的商户即错误行', () => {
      const r = validateListingRow({ ...goodRow, 供给商户: '查无此户' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'MERCHANT_NOT_FOUND')).toBe(true)
    })

    it('填了商户列时，楼盘没有生效关系也不影响这一行', () => {
      const noRelationCtx: RowContext = { ...ctx, buildingMerchantRelations: [] }
      const r = validateListingRow({ ...goodRow, 供给商户: '指定商户' }, 2, noRelationCtx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.merchantId).toBe(77)
    })
  })

  describe('出售条款四项（D5）', () => {
    const saleRow = { ...goodRow, 租金: '', 售价: '800万' }

    it('全部解析成枚举/布尔/数值', () => {
      const r = validateListingRow(
        { ...saleRow, 产权年限: '40年', 满五唯一: '是', 车位: '2', 税费承担: '买方承担' },
        2,
        ctx,
      )
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.saleTerms).toEqual({
        propertyRightYears: '40',
        saleTaxBearer: 'buyer',
        saleFiveYearsUnique: true,
        saleParkingSpaces: 2,
      })
    })

    it('填在租赁行上判错误行，不静默忽略——后台表单上永远看不到它们', () => {
      const r = validateListingRow({ ...goodRow, 产权年限: '40年' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'SALE_TERMS_ON_LEASE_ROW')).toBe(true)
    })

    it('出售行不填出售条款也合法（四项全部可选）', () => {
      const r = validateListingRow(saleRow, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.saleTerms).toBeNull()
    })

    it('产权年限非法取值判错误行', () => {
      const r = validateListingRow({ ...saleRow, 产权年限: '30年' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.column === '产权年限')).toBe(true)
    })

    it('满五唯一无法识别时判错误行，不默认成否', () => {
      const r = validateListingRow({ ...saleRow, 满五唯一: '不清楚' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'BOOLEAN_INVALID')).toBe(true)
    })
  })
})
