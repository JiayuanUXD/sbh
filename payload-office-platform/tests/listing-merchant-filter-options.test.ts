import { describe, expect, it } from 'vitest'

import { Listings } from '@/collections/Listings'

/**
 * merchant 字段 filterOptions 的「保存死锁」回归锁（终审修复，见
 * final-fix-report.md）。
 *
 * 背景：merchant-stop-listings.ts 在商户停用时把受影响房源转 pending，但
 * 不清空 listings.merchant（设计如此——运营需逐条显式重新发布）。后台表单
 * 保存是全量提交，若 filterOptions 只放行「启用+资质有效」，运营编辑这批
 * 房源里的任意字段都会因为 data 里带着旧商户 ID 而整单被拒——「待复核」
 * 因此变成事实上的保存死锁。修复：filterOptions 放行「合格商户 或 等于
 * 当前值」。这里不跑真实 Payload/DB，直接把 filterOptions 当纯函数调用
 * （它的实现只读 siblingData，不碰 req/user/DB），断言两个关键分支：
 *
 *   1. 当前值是已停用商户时，返回条件里必须放行该 id（否则死锁复现）；
 *   2. 当前值为空时，不能凭空造出 { id: { equals: undefined } } 这类
 *      条件——那会误伤「新建房源、merchant 尚未选择」的场景。
 */

type AnyField = Record<string, any>

function walk(nodes: AnyField[], visit: (node: AnyField) => void) {
  for (const node of nodes) {
    visit(node)
    if (Array.isArray(node.fields)) walk(node.fields, visit)
    if (Array.isArray(node.tabs)) walk(node.tabs, visit)
  }
}

const byName = new Map<string, AnyField>()
walk(Listings.fields as AnyField[], (n) => {
  if (n.name) byName.set(n.name, n)
})

const merchantField = byName.get('merchant')

/** 找出 Where 条件树里所有 `{ id: { equals: X } }` 形态的 X 值。 */
function collectIdEquals(where: unknown): unknown[] {
  if (!where || typeof where !== 'object') return []
  const w = where as Record<string, unknown>
  const found: unknown[] = []
  if (w.id && typeof w.id === 'object' && 'equals' in (w.id as object)) {
    found.push((w.id as { equals: unknown }).equals)
  }
  for (const key of ['and', 'or']) {
    const branch = w[key]
    if (Array.isArray(branch)) {
      for (const sub of branch) found.push(...collectIdEquals(sub))
    }
  }
  return found
}

describe('listing-merchant-filter-options/字段挂了 filterOptions', () => {
  it('merchant 字段存在，且 filterOptions 是函数', () => {
    expect(merchantField).toBeTruthy()
    expect(typeof merchantField?.filterOptions).toBe('function')
  })
})

describe('listing-merchant-filter-options/放行当前值，不放行合格候选之外的新选', () => {
  const call = (siblingData: Record<string, unknown>) =>
    merchantField!.filterOptions({ siblingData } as never)

  it('当前值是裸 id（已停用商户留下的旧值）：返回条件里包含该 id，不会挡保存', () => {
    const staleMerchantId = 4321
    const where = call({ merchant: staleMerchantId })
    expect(collectIdEquals(where)).toContain(staleMerchantId)
  })

  it('当前值是 populate 后的对象（{ id, ... }）：同样能取出 id 并放行', () => {
    const staleMerchantId = 'merchant-abc'
    const where = call({ merchant: { id: staleMerchantId, name: '某已停用商户' } })
    expect(collectIdEquals(where)).toContain(staleMerchantId)
  })

  it('当前值为空（null/undefined，新建房源尚未选商户）：不产生 { id: { equals: undefined } } 这类条件', () => {
    for (const empty of [null, undefined]) {
      const where = call({ merchant: empty })
      const idEquals = collectIdEquals(where)
      expect(idEquals).not.toContain(undefined)
      expect(idEquals).toEqual([])
    }
  })

  it('无论当前值是什么，「启用 + 资质有效」这条候选门槛始终在（新选仍受限）', () => {
    for (const siblingData of [{ merchant: null }, { merchant: 999 }, { merchant: { id: 999 } }]) {
      const where = call(siblingData) as Record<string, unknown>
      const branches = (where.or as unknown[] | undefined) ?? [where]
      const eligibleBranch = branches.find(
        (b) => b && typeof b === 'object' && 'and' in (b as object),
      ) as { and: unknown[] } | undefined
      expect(eligibleBranch, `未找到「启用+资质有效」分支: ${JSON.stringify(where)}`).toBeTruthy()
      expect(eligibleBranch!.and).toEqual([
        { status: { equals: 'active' } },
        { qualificationStatus: { equals: 'valid' } },
      ])
    }
  })
})
