import { describe, expect, it } from 'vitest'

import { validateBuildingRow, BUILDING_COLUMNS, type RowContext } from '@/domain/supply-import/building-row'
import type { LocationCandidate } from '@/domain/supply-import/resolve-refs'

const cities: LocationCandidate[] = [
  { id: 1, name: '上海', kind: 'city', parentId: null, status: 'active' },
  { id: 9, name: '外地', kind: 'city', parentId: null, status: 'active' },
  { id: 99, name: '停用市', kind: 'city', parentId: null, status: 'disabled' },
]
const districts: LocationCandidate[] = [
  { id: 10, name: '黄浦区', kind: 'district', parentId: 1, status: 'active' },
  { id: 11, name: '徐汇区', kind: 'district', parentId: 9, status: 'active' },
  { id: 12, name: '停用区', kind: 'district', parentId: 1, status: 'disabled' },
]
const businessAreas: LocationCandidate[] = [
  { id: 100, name: '人民广场', kind: 'business_area', parentId: 10, status: 'active' },
]
const metros: LocationCandidate[] = [
  { id: 200, name: '人民广场站', kind: 'metro_station', parentId: 1, status: 'active' },
]

/** 商户候选池（OPT-045「供给商户」列）：一个合格、一个停用、一对重名。 */
const MERCHANTS = [
  {
    id: 1,
    name: '官网',
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
    serviceCityIds: [1],
  },
  {
    id: 2,
    name: '已停用渠道',
    status: 'disabled',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
    serviceCityIds: [1],
  },
  {
    id: 3,
    name: '不覆盖上海的渠道',
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
    serviceCityIds: [9],
  },
  {
    id: 4,
    name: '重名商户',
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
    serviceCityIds: [1],
  },
  {
    id: 5,
    name: '重名商户',
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2099-12-31T00:00:00.000Z',
    serviceCityIds: [1],
  },
]

const ctx: RowContext = {
  tables: {
    locations: { city: cities, district: districts, business_area: businessAreas, metro_station: metros },
    aliases: { city: new Map(), district: new Map(), business_area: new Map(), metro_station: new Map() },
  },
  buildings: [],
  allowedCityIds: new Set([1]),
  // 楼盘不继承商户（D10 只影响房源），关系表留空；merchants 是 OPT-045 的
  // 「供给商户」列按名称解析用的候选池。
  buildingMerchantRelations: [],
  merchants: MERCHANTS,
  now: new Date('2026-08-22T00:00:00.000Z'),
}

const goodRow = {
  楼盘编号: 'B-001',
  楼盘名称: '环球金融中心',
  城市: '上海',
  行政区: '黄浦区',
  商圈: '人民广场',
  地址: '世纪大道 100 号',
  总楼层: '35层',
  总建筑面积: '150000㎡',
}

describe('validateBuildingRow', () => {
  it('模板列头固定且以编号打头', () => {
    expect(BUILDING_COLUMNS[0]).toBe('楼盘编号')
    // OPT-045 在原八列**之后**追加五列。追加而不是插入是硬要求：运营手上已有的
    // 表格按位置对应列头，中间插一列会让所有旧表格错位，而错位是静默的
    //（「地址」列的值落进「总楼层」，能解析成功的那部分不会报错）。
    expect(BUILDING_COLUMNS).toEqual([
      '楼盘编号', '楼盘名称', '城市', '行政区', '商圈', '地址', '总楼层', '总建筑面积',
      '供给商户', '等级', '竣工年份', '最近地铁', '在售单价',
    ])
  })

  it('完整正确行通过并产出规范化值', () => {
    const r = validateBuildingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      externalId: 'B-001',
      name: '环球金融中心',
      cityId: 1,
      districtId: 10,
      businessAreaId: 100,
      totalFloors: 35,
      grossFloorArea: 150000,
    })
  })

  it('缺编号即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘编号: '  ' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({
      rowNumber: 2, column: '楼盘编号', code: 'REQUIRED',
    })
  })

  it('缺名称即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘名称: '' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '楼盘名称' && e.code === 'REQUIRED')).toBe(true)
  })

  it('城市解析失败即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 城市: '不存在市' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '城市' && e.code === 'LOCATION_NOT_FOUND')).toBe(true)
  })

  it('行政区不属于所填城市即错误行', () => {
    // 徐汇区的 parentId 是外地(9)，goodRow 的城市是上海(1)，父子不匹配
    const r = validateBuildingRow({ ...goodRow, 行政区: '徐汇区' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '行政区' && e.code === 'LOCATION_PARENT_MISMATCH')).toBe(true)
  })

  it('商圈留空合法', () => {
    const r = validateBuildingRow({ ...goodRow, 商圈: '' }, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.businessAreaId).toBeNull()
  })

  it('越权城市判为错误行，而不是静默跳过，且是 errors[0]', () => {
    const r = validateBuildingRow(
      { ...goodRow, 城市: '外地', 行政区: '徐汇区', 商圈: '' },
      2,
      ctx,
    )
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('allowedCityIds 为 all 时不做城市校验', () => {
    const r = validateBuildingRow(
      { ...goodRow, 城市: '外地', 行政区: '徐汇区', 商圈: '' },
      2,
      { ...ctx, allowedCityIds: 'all' },
    )
    expect(r.ok).toBe(true)
  })

  it('一行的多个问题一次全报出来，不是报一个就停', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘编号: '', 总楼层: '待定' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(2)
  })

  // ────────────────────────────────────────────────────────────
  // 最终评审 Critical 2：§7 要求城市/行政区 status=active
  // ────────────────────────────────────────────────────────────

  it('城市已停用即错误行 CITY_NOT_ACTIVE——导入的楼盘挂在停用城市下前台会 404', () => {
    const r = validateBuildingRow({ ...goodRow, 城市: '停用市', 行政区: '', 商圈: '' }, 2, {
      ...ctx,
      allowedCityIds: 'all',
    })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '城市' && e.code === 'CITY_NOT_ACTIVE')).toBe(true)
  })

  it('行政区已停用即错误行 DISTRICT_NOT_ACTIVE', () => {
    const r = validateBuildingRow({ ...goodRow, 行政区: '停用区', 商圈: '' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '行政区' && e.code === 'DISTRICT_NOT_ACTIVE')).toBe(true)
  })

  // ────────────────────────────────────────────────────────────
  // OPT-045 新增五列。核心不变量：**全部可留空**——运营手上已有的八列表格
  // 必须原样继续可用，否则这次改动等于强制全员重做表格。
  // ────────────────────────────────────────────────────────────

  it('五个新列全部留空时仍然通过，值为 null（旧表格保持可用）', () => {
    const r = validateBuildingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      merchantId: null,
      grade: null,
      completionDate: null,
      nearestMetroId: null,
      saleUnitPrice: null,
    })
  })

  describe('供给商户列', () => {
    it('按名称解析出 id', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '官网' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.merchantId).toBe(1)
    })

    it('全角空格/大小写差异不影响匹配（与地理别名同一套规范化）', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '　官网　' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.merchantId).toBe(1)
    })

    it('查无此商户即错误行', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '查无此户' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'MERCHANT_NOT_FOUND')).toBe(true)
    })

    it('停用商户报「已停用」而不是「未找到」——文案要指对方向', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '已停用渠道' }, 2, ctx)
      expect(r.ok).toBe(false)
      const err = r.ok === false && r.errors.find((e) => e.column === '供给商户')
      expect(err && err.code).toBe('MERCHANT_INELIGIBLE')
      expect(err && err.message).toContain('已停用')
    })

    it('商户服务城市不覆盖楼盘城市即错误行（§10）', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '不覆盖上海的渠道' }, 2, ctx)
      expect(r.ok).toBe(false)
      const err = r.ok === false && r.errors.find((e) => e.column === '供给商户')
      expect(err && err.code).toBe('MERCHANT_INELIGIBLE')
      expect(err && err.message).toContain('服务城市')
    })

    it('重名商户判错误行，不静默取第一个', () => {
      const r = validateBuildingRow({ ...goodRow, 供给商户: '重名商户' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'MERCHANT_NAME_AMBIGUOUS')).toBe(true)
    })
  })

  describe('等级列', () => {
    it('中文标签映射成枚举值', () => {
      const r = validateBuildingRow({ ...goodRow, 等级: '甲级' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.grade).toBe('grade-a')
    })

    it('非法取值即错误行，并列出合法取值', () => {
      const r = validateBuildingRow({ ...goodRow, 等级: 'A级' }, 2, ctx)
      expect(r.ok).toBe(false)
      const err = r.ok === false && r.errors.find((e) => e.column === '等级')
      expect(err && err.code).toBe('ENUM_UNKNOWN')
      expect(err && err.message).toContain('甲级')
    })
  })

  describe('竣工年份列', () => {
    it('四位年份归一成该年 1 月 1 日 UTC', () => {
      const r = validateBuildingRow({ ...goodRow, 竣工年份: '2010' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.completionDate).toBe('2010-01-01T00:00:00.000Z')
    })

    it('自由文本判错误行，不猜年份——猜错会让竣工年代筛选归错档且前台无信号', () => {
      for (const raw of ['2010年', '二〇一〇', '10', '2010-05']) {
        const r = validateBuildingRow({ ...goodRow, 竣工年份: raw }, 2, ctx)
        expect(r.ok, raw).toBe(false)
      }
    })

    it('超出 [1900, 当年+5] 判错误行', () => {
      expect(validateBuildingRow({ ...goodRow, 竣工年份: '1899' }, 2, ctx).ok).toBe(false)
      expect(validateBuildingRow({ ...goodRow, 竣工年份: '2099' }, 2, ctx).ok).toBe(false)
    })

    it('在建楼盘填未来竣工年（当年+5 以内）是合法的', () => {
      const r = validateBuildingRow({ ...goodRow, 竣工年份: '2029' }, 2, ctx)
      expect(r.ok).toBe(true)
    })
  })

  describe('最近地铁列', () => {
    it('解析出地铁站 id', () => {
      const r = validateBuildingRow({ ...goodRow, 最近地铁: '人民广场站' }, 2, ctx)
      expect(r.ok).toBe(true)
      expect(r.ok && r.value.nearestMetroId).toBe(200)
    })

    it('查无此站即错误行', () => {
      const r = validateBuildingRow({ ...goodRow, 最近地铁: '不存在站' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.column === '最近地铁')).toBe(true)
    })
  })

  describe('在售单价列', () => {
    it('裸数字与「万」写法都能解析', () => {
      expect(
        (validateBuildingRow({ ...goodRow, 在售单价: '52000' }, 2, ctx) as { value: { saleUnitPrice: number } }).value
          .saleUnitPrice,
      ).toBe(52000)
      expect(
        (validateBuildingRow({ ...goodRow, 在售单价: '5.2万' }, 2, ctx) as { value: { saleUnitPrice: number } }).value
          .saleUnitPrice,
      ).toBe(52000)
      expect(
        (validateBuildingRow({ ...goodRow, 在售单价: '5.2万元/㎡' }, 2, ctx) as { value: { saleUnitPrice: number } })
          .value.saleUnitPrice,
      ).toBe(52000)
    })

    it('区间写法判错误行，不静默取第一个数', () => {
      const r = validateBuildingRow({ ...goodRow, 在售单价: '5-6万' }, 2, ctx)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.errors.some((e) => e.code === 'SALE_UNIT_PRICE_INVALID')).toBe(true)
    })

    it('零和负数判错误行', () => {
      expect(validateBuildingRow({ ...goodRow, 在售单价: '0' }, 2, ctx).ok).toBe(false)
      expect(validateBuildingRow({ ...goodRow, 在售单价: '-100' }, 2, ctx).ok).toBe(false)
    })
  })
})
