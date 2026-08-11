import { describe, expect, it } from 'vitest'
import {
  parseSeedJson,
  stripJsonComments,
  validateSeedFile,
  type SeedFile,
} from '@/domain/geography/import-validation'

/** 构造一个合法的最小种子文件（每类节点各一），供测试改坏字段。 */
function makeValidSeed(): SeedFile {
  return {
    city: {
      name: '杭州市',
      immutableCode: 'CITY-HZ',
      slug: 'hangzhou',
      centerLatitude: 30.2741,
      centerLongitude: 120.1551,
      sortOrder: 30,
    },
    districts: [
      {
        name: '上城区',
        immutableCode: 'HZ-D-330102',
        slug: 'hangzhou-shangcheng',
        centerLatitude: 30.2,
        centerLongitude: 120.2,
        sortOrder: 10,
      },
    ],
    businessAreas: [
      {
        name: '武林广场',
        immutableCode: 'HZ-BA-WULINGUANGCHANG',
        slug: 'hangzhou-wulin',
        districtCode: 'HZ-D-330102',
        centerLatitude: 30.27,
        centerLongitude: 120.16,
        sortOrder: 10,
      },
    ],
    metroLines: [
      {
        name: '地铁1号线',
        immutableCode: 'HZ-ML-1',
        slug: 'hangzhou-metro-1',
        sortOrder: 1,
        stations: [
          {
            name: '湘湖',
            immutableCode: 'HZ-MS-XIANGHU',
            slug: 'hangzhou-metro-xianghu',
            centerLatitude: 30.15,
            centerLongitude: 120.25,
            sortOrder: 1,
          },
        ],
      },
    ],
  }
}

describe('validateSeedFile', () => {
  it('合法种子文件通过（零 issue）', () => {
    expect(validateSeedFile(makeValidSeed())).toEqual([])
  })

  it('区域代码格式错误：非法 immutableCode', () => {
    const seed = makeValidSeed()
    seed.city.immutableCode = 'city-hz' // 小写，违反 ^[A-Z0-9] 开头
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'INVALID_REGION_CODE' && i.path === 'city')).toBe(true)
  })

  it('层级断链：商圈 districtCode 指向不存在的行政区', () => {
    const seed = makeValidSeed()
    seed.businessAreas[0].districtCode = 'HZ-D-999999' // 文件内无此行政区
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'BROKEN_DISTRICT_REF')).toBe(true)
  })

  it('文件内重复 immutableCode（含站点）', () => {
    const seed = makeValidSeed()
    seed.districts[0].immutableCode = 'HZ-MS-XIANGHU' // 撞站点 code
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'DUP_IMMUTABLE_CODE')).toBe(true)
  })

  it('坐标越界：纬度 > 90', () => {
    const seed = makeValidSeed()
    seed.districts[0].centerLatitude = 91
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'INVALID_LATITUDE')).toBe(true)
  })

  it('坐标越界：经度 < -180', () => {
    const seed = makeValidSeed()
    seed.metroLines[0]!.stations![0]!.centerLongitude = -181
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'INVALID_LONGITUDE')).toBe(true)
  })

  it('坐标不完整：只填纬度不填经度', () => {
    const seed = makeValidSeed()
    seed.districts[0].centerLongitude = null as unknown as undefined
    delete seed.districts[0].centerLongitude
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'COORDINATE_INCOMPLETE')).toBe(true)
  })

  it('slug 冲突：文件内重复 slug', () => {
    const seed = makeValidSeed()
    seed.metroLines[0].slug = 'hangzhou-shangcheng' // 撞行政区 slug
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'DUP_SLUG')).toBe(true)
  })

  it('缺少必需字段：name', () => {
    const seed = makeValidSeed()
    delete (seed.districts[0] as { name?: string }).name
    const issues = validateSeedFile(seed)
    expect(issues.some((i) => i.code === 'MISSING_FIELD' && i.path === 'districts[0]')).toBe(true)
  })

  it('sortOrder 非法：负数或小数', () => {
    const seed = makeValidSeed()
    seed.metroLines[0]!.stations![0]!.sortOrder = -1
    expect(validateSeedFile(seed).some((i) => i.code === 'INVALID_SORT_ORDER')).toBe(true)

    const seed2 = makeValidSeed()
    seed2.city.sortOrder = 1.5
    expect(validateSeedFile(seed2).some((i) => i.code === 'INVALID_SORT_ORDER')).toBe(true)
  })

  it('顶层不是对象：拒绝', () => {
    const issues = validateSeedFile([1, 2, 3])
    expect(issues.some((i) => i.code === 'SEED_NOT_OBJECT')).toBe(true)
  })
})

describe('stripJsonComments / parseSeedJson', () => {
  it('剥离 // 行注释与块注释后解析', () => {
    const raw = `// 文件头说明
{
  /* 城市 */
  "city": { "name": "杭州市", "immutableCode": "CITY-HZ", "slug": "hangzhou" },
  "districts": [],
  "businessAreas": [],
  "metroLines": []
}
`
    const parsed = parseSeedJson(raw) as SeedFile
    expect(parsed.city.immutableCode).toBe('CITY-HZ')
  })

  it('剥离后保留数据完整性', () => {
    const raw = `// header
{
  "city": { "name": "杭州市", "immutableCode": "CITY-HZ", "slug": "hangzhou" },
  "districts": [],
  "businessAreas": [],
  "metroLines": []
}`
    expect(stripJsonComments(raw)).not.toMatch(/header/)
  })
})

/**
 * legacyCodes（存量对账别名）—— 「存量为准、只补差集」策略的入口（审核修复 P0-1）。
 * 声明错了会导致要么白建重复节点、要么错认成别的现实对象，故校验从严。
 */
describe('validateSeedFile：legacyCodes 存量别名', () => {
  it('合法的 legacyCodes 不产生 issue', () => {
    const seed = makeValidSeed()
    seed.city.legacyCodes = ['HZ']
    seed.districts[0].legacyCodes = ['HZ-XH', 'HZ-XIHU']
    expect(validateSeedFile(seed)).toEqual([])
  })

  it('legacyCodes 非数组 → INVALID_LEGACY_CODES', () => {
    const seed = makeValidSeed()
    ;(seed.city as { legacyCodes?: unknown }).legacyCodes = 'HZ'
    expect(validateSeedFile(seed).map((i) => i.code)).toContain('INVALID_LEGACY_CODES')
  })

  it('别名格式非法（小写 / 过短）→ INVALID_LEGACY_CODE', () => {
    const seed = makeValidSeed()
    seed.city.legacyCodes = ['hz']
    expect(validateSeedFile(seed).map((i) => i.code)).toContain('INVALID_LEGACY_CODE')
  })

  it('别名等于自身 immutableCode → LEGACY_CODE_SELF', () => {
    const seed = makeValidSeed()
    seed.city.legacyCodes = ['CITY-HZ']
    expect(validateSeedFile(seed).map((i) => i.code)).toContain('LEGACY_CODE_SELF')
  })

  it('两个节点认领同一个存量别名 → DUP_LEGACY_CODE', () => {
    const seed = makeValidSeed()
    seed.city.legacyCodes = ['HZ-OLD']
    seed.districts[0].legacyCodes = ['HZ-OLD']
    expect(validateSeedFile(seed).map((i) => i.code)).toContain('DUP_LEGACY_CODE')
  })

  it('别名撞上文件内某节点的 immutableCode → LEGACY_CODE_COLLIDES_WITH_CODE', () => {
    const seed = makeValidSeed()
    // 城市认领了「行政区自己的新码」，会让两个种子节点指向同一条库记录
    seed.city.legacyCodes = [seed.districts[0].immutableCode]
    expect(validateSeedFile(seed).map((i) => i.code)).toContain(
      'LEGACY_CODE_COLLIDES_WITH_CODE',
    )
  })

  it('legacyCodes 缺省时行为不变（向后兼容既有种子文件）', () => {
    const seed = makeValidSeed()
    expect(seed.city.legacyCodes).toBeUndefined()
    expect(validateSeedFile(seed)).toEqual([])
  })
})