import { describe, expect, it } from 'vitest'

import { protectListingReview } from '@/domain/review/listing-review-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M4.4 审核记录保护 hook 单测（design §3.5 / §4.3）
 *
 * 审核记录一经创建即不可修改、不可物理删除（append-only）。
 * create 时:校验 decision / task_status 枚举、驳回必须填原因、写入快照哈希、初始化 version=1。
 * update 时:任何字段变更都被拒绝(IllegalStateTransitionError)。
 */
const run = (args: Record<string, unknown>) =>
  protectListingReview(args as never) as Promise<Record<string, unknown>>

const create = (data: Record<string, unknown>) =>
  run({ operation: 'create', originalDoc: undefined, data })

const update = (data: Record<string, unknown>, originalDoc: Record<string, unknown>) =>
  run({ operation: 'update', originalDoc, data })

describe('protectListingReview - create 时校验与冻结', () => {
  it('submit 动作:推导 task_status=pending、初始化 version=1', async () => {
    const out = await create({ listing: 42, decision: 'submit', snapshot: { listing: 42, listingVersion: 5 } })
    expect(out.taskStatus).toBe('pending')
    expect(out.version).toBe(1)
  })

  it('approve 动作:推导 task_status=resolved', async () => {
    const out = await create({ listing: 42, decision: 'approve' })
    expect(out.taskStatus).toBe('resolved')
  })

  it('withdraw 动作:推导 task_status=cancelled', async () => {
    const out = await create({ listing: 42, decision: 'withdraw' })
    expect(out.taskStatus).toBe('cancelled')
  })

  it('reject 动作 + 原因:推导 task_status=resolved', async () => {
    const out = await create({ listing: 42, decision: 'reject', reason: '资料不全' })
    expect(out.taskStatus).toBe('resolved')
  })

  it('task_status 由动作单一推导,不信任外部传入的错误值', async () => {
    const out = await create({ listing: 42, decision: 'submit', taskStatus: 'resolved' })
    expect(out.taskStatus).toBe('pending')
  })

  it('带 snapshot 时服务端重算 snapshot_hash(64 位 hex)', async () => {
    const out = await create({ listing: 42, decision: 'submit', snapshot: { listing: 42, listingVersion: 5 } })
    expect(out.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('protectListingReview - create 非法输入', () => {
  it('缺失 decision 抛 DomainError', async () => {
    await expect(create({ listing: 42 })).rejects.toBeInstanceOf(DomainError)
  })

  it('非法 decision 抛 DomainError', async () => {
    await expect(create({ listing: 42, decision: 'nope' })).rejects.toBeInstanceOf(DomainError)
  })

  it('reject 缺原因抛 DomainError', async () => {
    await expect(create({ listing: 42, decision: 'reject' })).rejects.toBeInstanceOf(DomainError)
  })

  it('reject 原因仅空白抛 DomainError', async () => {
    await expect(create({ listing: 42, decision: 'reject', reason: '   ' })).rejects.toBeInstanceOf(DomainError)
  })
})

describe('protectListingReview - append-only 不可变', () => {
  it('任何 update 都被拒绝(审核记录创建后不可修改)', async () => {
    await expect(
      update({ decision: 'approve' }, { id: 1, decision: 'submit', taskStatus: 'pending' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('即便数据未变的 update 也被拒绝', async () => {
    const doc = { id: 1, decision: 'submit', taskStatus: 'pending' }
    await expect(update({ ...doc }, doc)).rejects.toBeInstanceOf(DomainError)
  })
})
