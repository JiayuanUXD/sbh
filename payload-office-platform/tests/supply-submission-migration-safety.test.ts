import { describe, expect, it, vi } from 'vitest'

import { Notifications } from '@/collections/Notifications'
import { up as duplicatePreflight } from '@/migrations/20260809_180000_supply_notification_duplicates_preflight'
import {
  buildSupplyRollbackAssessment,
  type SupplyRollbackCounts,
} from '../scripts/preflight-supply-rollback'

describe('notification unique-index duplicate preflight', () => {
  it('passes an empty or already-constrained database without writing rows', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ duplicate_group_count: 0 }] })
    await expect(duplicatePreflight({ db: { execute } } as never)).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('matches PostgreSQL NULL uniqueness while the collection requires every key field', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ duplicate_group_count: 0 }] })
    await duplicatePreflight({ db: { execute } } as never)
    const query = JSON.stringify(execute.mock.calls)
    expect(query).toContain('IS NOT NULL')
    for (const fieldName of ['eventId', 'recipient', 'type']) {
      expect(Notifications.fields).toContainEqual(expect.objectContaining({
        name: fieldName,
        required: true,
      }))
    }
  })

  it('blocks duplicate history with count-only remediation guidance', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ duplicate_group_count: 3 }] })
    await expect(duplicatePreflight({ db: { execute } } as never)).rejects.toThrow(
      /3 duplicate notification key group\(s\)/,
    )
    const serialized = JSON.stringify(execute.mock.calls)
    expect(serialized).not.toContain('DELETE FROM')
  })
})

describe('guarded supply rollback preflight', () => {
  const zero: SupplyRollbackCounts = {
    supplySubmissions: 0,
    entrustLeads: 0,
    supplyNotificationTypes: 0,
    supplyNotificationSources: 0,
    supplyDomainEventTypes: 0,
    supplyDomainAggregateTypes: 0,
    supplyJobTasks: 0,
    supplyJobLogTasks: 0,
  }

  it('blocks when any value cannot be represented by the old schema', () => {
    expect(buildSupplyRollbackAssessment({ ...zero, supplySubmissions: 1 })).toMatchObject({
      safe: false,
      blockers: ['supply_submissions rows: 1'],
    })
    expect(buildSupplyRollbackAssessment({ ...zero, entrustLeads: 2 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyNotificationTypes: 3 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyNotificationSources: 4 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyDomainEventTypes: 1 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyDomainAggregateTypes: 1 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyJobTasks: 1 }).safe).toBe(false)
    expect(buildSupplyRollbackAssessment({ ...zero, supplyJobLogTasks: 1 }).safe).toBe(false)
  })

  it('permits only a controlled, explicitly ordered rollback when every guard is zero', () => {
    const result = buildSupplyRollbackAssessment(zero)
    expect(result.safe).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.instructions.join('\n')).toContain('不要直接执行 payload migrate:down')
    expect(result.instructions.join('\n')).toContain('先回退通知唯一索引')
  })
})
