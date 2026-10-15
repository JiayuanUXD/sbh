import { readFileSync } from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

import {
  LISTING_PAGE_SIZE_DEFAULT,
  LISTING_PAGE_SIZE_OPTIONS,
  resolveListingPageSize,
} from '@/components/admin/listings-list-page-size'

/**
 * 房源后台列表每页条数（OPT-114）。
 *
 * 一个楼盘几百套房源、只留少数上架时，要能在一页里「全选 → 取消要保留的 → 批量下架」，
 * 所以白名单加了 200 / 500。服务端与分页下拉共用这一份白名单。
 */

describe('resolveListingPageSize', () => {
  it.each(['10', '25', '50', '100'])('原有档位 %s 原样放行', (raw) => {
    expect(resolveListingPageSize(raw)).toBe(Number(raw))
  })

  it.each(['200', '500'])('新增档位 %s 放行', (raw) => {
    expect(resolveListingPageSize(raw)).toBe(Number(raw))
  })

  it.each([
    ['白名单外的数', '1000'],
    ['白名单外的小数', '30'],
    ['非数字', 'abc'],
    ['缺省', null],
  ])('%s → 回落默认', (_label, raw) => {
    expect(resolveListingPageSize(raw)).toBe(LISTING_PAGE_SIZE_DEFAULT)
  })

  it('默认 25，且默认值本身在白名单里', () => {
    expect(LISTING_PAGE_SIZE_DEFAULT).toBe(25)
    expect(LISTING_PAGE_SIZE_OPTIONS).toContain(LISTING_PAGE_SIZE_DEFAULT)
  })

  it('白名单升序（分页下拉按这个顺序展示）', () => {
    expect([...LISTING_PAGE_SIZE_OPTIONS]).toEqual([10, 25, 50, 100, 200, 500])
  })
})

/**
 * OPT-114 D5：列表查询带了 select，只取行映射用到的字段。
 * 将来有人在映射里新读一个 `doc.xxx` 却忘了加进 select，那一列会**静默变空**
 * （类型检查拦不住：映射前有一次 `as Listing[]`）。这里读源码对齐两边。
 */
describe('ListingsListView 的 select 覆盖行映射读到的全部字段', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../src/components/admin/ListingsListView.tsx'),
    'utf8',
  )

  it('每个 doc.<字段> 都在 select 里', () => {
    const selectBlock = /select: \{([^}]*)\}/.exec(source)?.[1]
    expect(selectBlock, '找不到 listings 查询的 select 块').toBeTruthy()
    const selected = new Set(
      [...(selectBlock ?? '').matchAll(/(\w+): true/g)].map((m) => m[1]),
    )
    const read = new Set([...source.matchAll(/\bdoc\.(\w+)/g)].map((m) => m[1]))
    // id 恒返回，不用 select。
    read.delete('id')
    expect(read.size, '没解析到任何 doc.<字段>，正则与源码脱节').toBeGreaterThan(5)
    const missing = [...read].filter((field) => !selected.has(field))
    expect(missing, `行映射读了但 select 没取：${missing.join('、')}`).toEqual([])
  })
})
