import { describe, expect, it } from 'vitest'

import {
  isDestructiveRiskApproved,
  loadDestructiveMigrationApprovals,
  APPROVALS_FILE_PATH,
  type DestructiveMigrationApprovalEntry,
} from '../scripts/destructive-migration-approvals'

/**
 * 批准清单的匹配逻辑必须绑「迁移名 + 风险类别 + 出现次数」三者，不能只认迁移名——
 * 否则被批准的那个迁移文件今后再加任何 DROP TABLE / DROP COLUMN 都会被静默放行。
 * 这些用例全部用构造好的 approvals 数组跑，不碰真实的
 * DESTRUCTIVE_MIGRATION_APPROVALS.json，纯函数、不依赖磁盘状态。
 */
const fixture: DestructiveMigrationApprovalEntry[] = [
  {
    migrationName: '20260101_000000_example_drop',
    approvedIn: 'TEST-000',
    approvedWhat: '测试用例',
    impact: '测试用例，无实际影响',
    approvedRiskCounts: { DROP_TABLE: 1, DROP_COLUMN: 2 },
  },
]

describe('isDestructiveRiskApproved：内容指纹匹配', () => {
  it('迁移名 + 类别 + 次数三者都对上才放行', () => {
    expect(
      isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_TABLE', 1, fixture),
    ).toBe(true)
    expect(
      isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_COLUMN', 2, fixture),
    ).toBe(true)
  })

  it('次数变多（新增了一条同类风险）不再放行——不是 >= 判定', () => {
    expect(
      isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_TABLE', 2, fixture),
    ).toBe(false)
  })

  it('次数变少也不放行——批准记录的是当时的确切次数', () => {
    expect(
      isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_COLUMN', 1, fixture),
    ).toBe(false)
  })

  it('迁移名对不上不放行，即便类别与次数都对', () => {
    expect(isDestructiveRiskApproved('some_other_migration', 'DROP_TABLE', 1, fixture)).toBe(
      false,
    )
  })

  it('批准记录里没有这个类别（比如只批了 DROP_TABLE 没批 DROP_COLUMN）不放行', () => {
    const onlyTable: DestructiveMigrationApprovalEntry[] = [
      {
        migrationName: '20260101_000000_example_drop',
        approvedIn: 'TEST-000',
        approvedWhat: '测试用例',
        impact: '测试用例',
        approvedRiskCounts: { DROP_TABLE: 1 },
      },
    ]
    expect(
      isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_COLUMN', 1, onlyTable),
    ).toBe(false)
  })

  it('批准清单为空数组：任何迁移都不放行', () => {
    expect(isDestructiveRiskApproved('20260101_000000_example_drop', 'DROP_TABLE', 1, [])).toBe(
      false,
    )
  })
})

describe('loadDestructiveMigrationApprovals：真实清单文件', () => {
  it('清单文件路径指向仓库顶层 DESTRUCTIVE_MIGRATION_APPROVALS.json', () => {
    expect(APPROVALS_FILE_PATH.replace(/\\/g, '/')).toMatch(
      /DESTRUCTIVE_MIGRATION_APPROVALS\.json$/,
    )
  })

  it('真实清单里，OPT-034 Task 6 的删表迁移条目字段齐全', () => {
    const approvals = loadDestructiveMigrationApprovals()
    const entry = approvals.find(
      (a) => a.migrationName === '20260820_055534_drop_listing_merchant_relations',
    )
    expect(entry).toBeDefined()
    expect(entry?.approvedIn).toMatch(/OPT-034/)
    expect(entry?.approvedWhat.length).toBeGreaterThan(0)
    expect(entry?.impact.length).toBeGreaterThan(0)
    expect(entry?.approvedRiskCounts).toEqual({ DROP_TABLE: 1, DROP_COLUMN: 1 })
  })
})
