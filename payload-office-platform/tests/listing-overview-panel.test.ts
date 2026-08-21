import { describe, expect, it } from 'vitest'
import { buildListingOverviewGroups } from '@/components/frontend/detail/ListingOverviewPanel'
import type { FactGroupViewModel, FactValue } from '@/domain/public-catalog'

/**
 * `buildListingOverviewGroups` 是房源概况面板（OPT-037 Task 3）的纯函数分组
 * 逻辑——按标签从 `listing.factGroups` 里查值、重新分组、且「物业费」走
 * 金额优先、类别兜底的双源回退。此前只靠读三张截图验证，这里补上真正的
 * 分支覆盖：值存在 / 值缺失渲染为 `—`（SpecTable 层的 `—` 由 value:null 触发，
 * 这里断言的是 value 本身，即「传给 SpecTable 的到底是不是 null」）/ 双源
 * 回退取到第二来源。
 */

function fact(label: string, value: string | null, estimated = false): FactValue {
  return { label, value, estimated, critical: false }
}

const BASE_FACT_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'space',
    title: '空间信息',
    facts: [fact('建筑面积', '1,240 ㎡')],
  },
  {
    id: 'cost',
    title: '费用条款',
    facts: [fact('最短租期', '36 个月'), fact('押金月数', null), fact('付款方式', null)],
  },
]

describe('buildListingOverviewGroups', () => {
  it('值存在时原样传给对应行', () => {
    const groups = buildListingOverviewGroups({
      factGroups: BASE_FACT_GROUPS,
      price: null,
      availableFrom: null,
      building: null,
    })
    const spaceGroup = groups.find((g) => g.id === 'space')
    const areaRow = spaceGroup?.rows.find((r) => r.label === '建筑面积')
    expect(areaRow?.value).toBe('1,240 ㎡')
  })

  it('listing.factGroups 里查不到值时，行的 value 为 null（交给 SpecTable 渲染 —），不隐藏该行', () => {
    const groups = buildListingOverviewGroups({
      factGroups: BASE_FACT_GROUPS,
      price: null,
      availableFrom: null,
      building: null,
    })
    const termsGroup = groups.find((g) => g.id === 'terms')
    const depositRow = termsGroup?.rows.find((r) => r.label === '押金')
    const paymentRow = termsGroup?.rows.find((r) => r.label === '付款方式')
    // 行必须存在（不是被过滤掉），值为 null
    expect(depositRow).toBeDefined()
    expect(depositRow?.value).toBeNull()
    expect(paymentRow).toBeDefined()
    expect(paymentRow?.value).toBeNull()
  })

  it('物业费金额缺失时，回退到物业费类别事实（双源取第二来源）', () => {
    const factGroupsWithoutAmount: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS,
      {
        id: 'cost-extra',
        title: '费用条款补充',
        facts: [fact('物业费金额', null), fact('物业费', '包含')],
      },
    ]
    const groups = buildListingOverviewGroups({
      factGroups: factGroupsWithoutAmount,
      price: null,
      availableFrom: null,
      building: null,
    })
    const costGroup = groups.find((g) => g.id === 'cost')
    const propertyFeeRow = costGroup?.rows.find((r) => r.label === '物业费')
    expect(propertyFeeRow?.value).toBe('包含')
  })

  it('物业费金额存在时优先取金额，不取类别（双源取第一来源）', () => {
    const factGroupsWithAmount: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS,
      {
        id: 'cost-extra',
        title: '费用条款补充',
        facts: [fact('物业费金额', '28.00 元/㎡/月'), fact('物业费', '包含')],
      },
    ]
    const groups = buildListingOverviewGroups({
      factGroups: factGroupsWithAmount,
      price: null,
      availableFrom: null,
      building: null,
    })
    const costGroup = groups.find((g) => g.id === 'cost')
    const propertyFeeRow = costGroup?.rows.find((r) => r.label === '物业费')
    expect(propertyFeeRow?.value).toBe('28.00 元/㎡/月')
  })
})
