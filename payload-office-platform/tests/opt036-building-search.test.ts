import { describe, expect, it } from 'vitest'
import { parseBuildingSearchInput, buildBuildingCanonicalParams } from '@/domain/public-catalog/building-search'

const parse = (qs: string) => parseBuildingSearchInput(new URLSearchParams(qs))

describe('parseBuildingSearchInput', () => {
  it('空查询给出默认值', () => {
    expect(parse('')).toEqual({ sort: 'stock-desc', page: 1, pageSize: 24 })
  })
  it('多值维度解析为数组并去重去空', () => {
    expect(parse('district=jingan&district=huangpu&district=jingan').district).toEqual(['jingan', 'huangpu'])
    expect(parse('grade=a&metro=line2&metro=line10').metro).toEqual(['line2', 'line10'])
  })
  it('排序走白名单，非法值降级为 stock-desc', () => {
    expect(parse('sort=area-desc').sort).toBe('area-desc')
    expect(parse('sort=DROP TABLE').sort).toBe('stock-desc')
  })
  it('数值维度非法或越界时丢弃而非报错', () => {
    expect(parse('leasableAreaMin=abc').leasableAreaMin).toBeUndefined()
    expect(parse('leasableAreaMin=-5').leasableAreaMin).toBeUndefined()
    expect(parse('completedAfter=19').completedAfter).toBeUndefined()
    expect(parse('completedAfter=2010').completedAfter).toBe(2010)
  })
  it('数值维度拒绝前后空白，与 parseBuildingSupplyNumber 口径一致', () => {
    expect(parse('leasableAreaMin=%20500').leasableAreaMin).toBeUndefined()
    expect(parse('leasableAreaMin=500%20').leasableAreaMin).toBeUndefined()
    expect(parse('leasableAreaMin=500').leasableAreaMin).toBe(500)
  })
  it('completedAfter 上界为当前年份（含边界），拒绝当前年份+1', () => {
    const currentYear = new Date().getFullYear()
    expect(parse(`completedAfter=${currentYear}`).completedAfter).toBe(currentYear)
    expect(parse(`completedAfter=${currentYear + 1}`).completedAfter).toBeUndefined()
  })
  it('completedAfter 下界为 1900（含边界），拒绝 1899', () => {
    expect(parse('completedAfter=1900').completedAfter).toBe(1900)
    expect(parse('completedAfter=1899').completedAfter).toBeUndefined()
  })
  it('min 大于 max 时两者都丢弃，不产生空结果陷阱', () => {
    const input = parse('leasableAreaMin=900&leasableAreaMax=100')
    expect(input.leasableAreaMin).toBeUndefined()
    expect(input.leasableAreaMax).toBeUndefined()
  })
  it('onlyWithStock 只认 "1"', () => {
    expect(parse('onlyWithStock=1').onlyWithStock).toBe(true)
    expect(parse('onlyWithStock=true').onlyWithStock).toBeUndefined()
  })
  it('page 下限为 1', () => {
    expect(parse('page=0').page).toBe(1)
    expect(parse('page=3').page).toBe(3)
  })
  it('page 上限为 10000（含边界），越界降级为默认页 1', () => {
    expect(parse('page=10000').page).toBe(10000)
    expect(parse('page=10001').page).toBe(1)
    expect(parse('page=999999999').page).toBe(1)
  })
})

describe('buildBuildingCanonicalParams', () => {
  it('默认值不写进 URL', () => {
    expect(buildBuildingCanonicalParams(parse('')).toString()).toBe('')
    expect(buildBuildingCanonicalParams(parse('sort=stock-desc&page=1')).toString()).toBe('')
  })
  it('同一组条件不同书写顺序产生同一个 canonical', () => {
    const a = buildBuildingCanonicalParams(parse('grade=a&district=huangpu&district=jingan'))
    const b = buildBuildingCanonicalParams(parse('district=jingan&district=huangpu&grade=a'))
    expect(a.toString()).toBe(b.toString())
  })
  /**
   * OPT-081：`?view=` 只改版式、不改结果集，两个只差 view 的 URL 对搜索引擎必须是
   * **同一个页面**，因此 canonical 里不能出现它（同房源页裁定）。
   *
   * 这条防的是一个很自然的「修法」：有人发现点筛选会丢版式，于是把 view 塞进
   * `buildBuildingCanonicalParams` 就地解决——那会让 `?view=grid` 与 `?view=row`
   * 变成两个可索引 URL、互为重复内容。正确做法是在视图层把 view 挂回 currentParams
   * （CityBuildingsView 里那一行），canonical 保持干净。
   */
  it('view 不进 canonical（版式不是结果集，两个版式是同一个可索引页面）', () => {
    expect(buildBuildingCanonicalParams(parse('view=row')).toString()).toBe('')
    expect(buildBuildingCanonicalParams(parse('view=grid')).toString()).toBe('')
    expect(buildBuildingCanonicalParams(parse('district=jingan&view=row')).toString()).toBe(
      buildBuildingCanonicalParams(parse('district=jingan')).toString(),
    )
  })
})
