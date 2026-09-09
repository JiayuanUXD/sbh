import { describe, expect, it } from 'vitest'
import { buildBuildingSpecGroups } from '@/components/frontend/detail/BuildingSpecPanel'
import { buildListingOverviewGroups } from '@/components/frontend/detail/ListingOverviewPanel'
import type { FactGroupViewModel, FactValue } from '@/domain/public-catalog'

/**
 * OPT-082：详情页参数区的「逐级收起」。
 *
 * ## 这条规则是对既有不变量的**刻意反转**
 *
 * 改造前 `SpecTable` 的契约是「`value: null` 必须渲染 `—` 且保留该行」，理由是
 * 隐藏一个维度等于暗示它不存在。那条理由针对的是**数据缺失**：某套房源在这个
 * 维度上没有可核实的值，此时 `—` 本身是信息。
 *
 * 本工作项引入的是**运营的编辑决策**：全站范围内决定不披露某个维度。两者不是
 * 一回事，但产品裁定（见 `specs/work-items/OPT-082-detail-spec-field-visibility.md`
 * §2）把两种「不显示」统一成了同一种呈现——没值就不显这行。代价已在规格 §11
 * 记录（「未勾选」与「没值」在前台不可区分、「资料不全」的信号被弱化），是已知
 * 且被接受的取舍，不是漏考虑。
 *
 * 改这条规则前先读那份规格，别只看 `SpecTable` 的注释。
 */

function fact(label: string, value: string | null, estimated = false): FactValue {
  return { label, value, estimated, critical: false }
}

const ONLY_TOTAL_FLOORS: readonly FactGroupViewModel[] = [
  { id: 'building', title: '建筑信息', facts: [fact('总楼层', '28 层')] },
]

describe('楼盘参数：逐级收起', () => {
  it('值为 null 的行不出现（同组内有值的行照常在）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: ONLY_TOTAL_FLOORS, amenityGroups: [] },
      null,
    )
    const structure = groups.find((group) => group.id === 'structure')
    expect(structure?.rows.map((row) => row.label)).toEqual(['总楼层'])
    expect(structure?.rows.every((row) => row.value != null)).toBe(true)
  })

  it('一组内全无值时整组不出现（含组标题）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: ONLY_TOTAL_FLOORS, amenityGroups: [] },
      null,
    )
    // 只有「总楼层」有值，它落在 structure 组；其余三组全空
    expect(groups.map((group) => group.id)).toEqual(['structure'])
  })

  it('全部无值时返回空数组——调用方据此整块不渲染，不留空货架', () => {
    expect(buildBuildingSpecGroups({ factGroups: [], amenityGroups: [] }, null)).toEqual([])
  })

  it('未勾选的字段即使有值也不出现', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: ONLY_TOTAL_FLOORS, amenityGroups: [] },
      null,
      { totalFloors: false },
    )
    expect(groups).toEqual([])
  })

  it('配置里没提到的 key 按 registry 默认走（配置比代码旧时不让新字段集体消失）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: ONLY_TOTAL_FLOORS, amenityGroups: [] },
      null,
      { someKeyThatDoesNotExist: false },
    )
    expect(groups.find((group) => group.id === 'structure')?.rows.map((row) => row.label)).toEqual([
      '总楼层',
    ])
  })
})

describe('房源概况：逐级收起', () => {
  const ONLY_AREA: readonly FactGroupViewModel[] = [
    { id: 'space', title: '空间信息', facts: [fact('建筑面积', '1,240 ㎡')] },
  ]

  it('值为 null 的行不出现', () => {
    const groups = buildListingOverviewGroups({
      factGroups: ONLY_AREA,
      price: null,
      availableFrom: null,
      building: null,
    } as never)
    expect(groups.find((group) => group.id === 'space')?.rows.map((row) => row.label)).toEqual([
      '建筑面积',
    ])
  })

  it('「交付时间」缺失时走既有的「面议」语义，不算无值', () => {
    // formatAvailableDate(null) 返回 '面议'（站内既有兜底文案，非 null），
    // 所以 delivery 组即使其它字段全缺也仍会保留这一行——这是刻意的：
    // 「面议」是真实信息，不是缺失。
    const groups = buildListingOverviewGroups({
      factGroups: ONLY_AREA,
      price: null,
      availableFrom: null,
      building: null,
    } as never)
    expect(groups.find((group) => group.id === 'delivery')?.rows.map((row) => row.label)).toEqual([
      '交付时间',
    ])
  })

  it('未勾选的字段即使有值也不出现', () => {
    const groups = buildListingOverviewGroups(
      { factGroups: ONLY_AREA, price: null, availableFrom: null, building: null } as never,
      { area: false },
    )
    expect(groups.find((group) => group.id === 'space')).toBeUndefined()
  })

  it('勾上「信息时效」两项后该组才出现（默认关闭）', () => {
    const factGroups: readonly FactGroupViewModel[] = [
      ...ONLY_AREA,
      {
        id: 'verification',
        title: '信息时效',
        facts: [fact('信息核验时间', '2026-03-14T00:00:00.000Z'), fact('价格核验时间', null)],
      },
    ]
    const base = { factGroups, price: null, availableFrom: null, building: null } as never

    expect(buildListingOverviewGroups(base).find((g) => g.id === 'verification')).toBeUndefined()

    const opened = buildListingOverviewGroups(base, { verifiedAt: true, priceVerifiedAt: true })
    const verification = opened.find((group) => group.id === 'verification')
    // 「价格核验时间」无值 → 该行不出现；「信息核验时间」渲染成日期而不是 ISO 串
    expect(verification?.rows.map((row) => row.label)).toEqual(['信息核验时间'])
    expect(verification?.rows[0]?.value).toMatch(/^2026-03-1[34]$/)
  })
})
