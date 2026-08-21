import { describe, expect, it } from 'vitest'

import { markDuplicateExternalIds } from '@/domain/supply-import/duplicate-check'

describe('markDuplicateExternalIds', () => {
  it('首次出现保留，第二次起判错并剔除', () => {
    const rows = [{ externalId: 'L-1' }, { externalId: 'L-2' }, { externalId: 'L-1' }]
    const result = markDuplicateExternalIds(rows, [2, 3, 4], '房源编号')

    expect(result.kept).toEqual([{ externalId: 'L-1' }, { externalId: 'L-2' }])
    expect(result.keptRowNumbers).toEqual([2, 3])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      rowNumber: 4, column: '房源编号', rawValue: 'L-1', code: 'DUPLICATE_EXTERNAL_ID',
    })
    // 错误消息要指出跟哪一行撞了，否则运营不知道去哪儿改
    expect(result.errors[0].message).toContain('2')
  })

  it('全不重复时原样返回', () => {
    const rows = [{ externalId: 'L-1' }, { externalId: 'L-2' }]
    const result = markDuplicateExternalIds(rows, [2, 3], '房源编号')
    expect(result.kept).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })
})
