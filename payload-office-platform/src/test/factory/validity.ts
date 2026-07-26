/**
 * PostgreSQL 有效期关系测试数据（tasks.md M3.3, M4.2）
 *
 * 业务约束（AGENTS.md §9.2, §3.3, §4.2）：
 *   - 供给有效期关系必须使用数据库级约束防止重叠（PG EXCLUDE constraint）
 *   - SQLite 用事务内应用校验模拟
 *   - 边界时刻精确切换：包含起、不包含止 [start, end)
 *
 * M0 阶段：仅产出 fixture，不写 Collection。
 * M3.3+ 将基于此 fixture 验证 EXCLUDE 约束。
 */

import type { ValidityPeriod } from '@/domain/shared/validity'
import { periodsOverlap } from '@/domain/shared/validity'

export type BuildingMerchantRelationFixture = {
  id: string
  buildingId: string
  merchantId: string
  validity: ValidityPeriod
  /** 测试用预期：该关系是否应被 PG EXCLUDE 约束接受 */
  expectAccepted: boolean
  /** 测试用预期：失败原因 */
  expectRejectReason?: string
}

/**
 * Building-Merchant 有效期关系矩阵
 *
 * 所有时间使用 UTC ISO 字符串。
 * building-A 同一 merchant 不允许重叠（应触发 EXCLUDE 约束）。
 */
export const BUILDING_MERCHANT_RELATIONS: BuildingMerchantRelationFixture[] = [
  // 1. 正常有效期（独立窗口）
  {
    id: 'rel-1-active',
    buildingId: 'building-A',
    merchantId: 'merchant-active-shanghai',
    validity: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z',
    },
    expectAccepted: true,
  },
  // 2. 接续窗口（与 rel-1 在边界相接，不重叠）
  {
    id: 'rel-2-adjacent',
    buildingId: 'building-A',
    merchantId: 'merchant-active-shanghai',
    validity: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.000Z',
    },
    expectAccepted: true,
  },
  // 3. 与 rel-1 完全重叠（应被拒绝）
  {
    id: 'rel-3-overlap-with-rel-1',
    buildingId: 'building-A',
    merchantId: 'merchant-active-shanghai',
    validity: {
      startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-05-31T23:59:59.000Z',
    },
    expectAccepted: false,
    expectRejectReason: 'overlap_with_existing',
  },
  // 4. 与 rel-1 部分重叠（应被拒绝）
  {
    id: 'rel-4-partial-overlap',
    buildingId: 'building-A',
    merchantId: 'merchant-active-shanghai',
    validity: {
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-08-31T23:59:59.000Z',
    },
    expectAccepted: false,
    expectRejectReason: 'overlap_with_existing',
  },
  // 5. 边界相接（startsAt = rel-2.endsAt，不重叠；rel-1 已结束、rel-2 是最近的有效期）
  {
    id: 'rel-5-boundary-touch',
    buildingId: 'building-A',
    merchantId: 'merchant-active-shanghai',
    validity: {
      startsAt: '2026-12-31T23:59:59.000Z', // = rel-2.endsAt → 边界相接
      endsAt: '2027-06-30T23:59:59.000Z',
    },
    expectAccepted: true,
  },
  // 6. 无限期（endsAt=null）
  {
    id: 'rel-6-indefinite',
    buildingId: 'building-B',
    merchantId: 'merchant-multi-city',
    validity: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: null,
    },
    expectAccepted: true,
  },
  // 7. 不同 merchant 同一 building（允许并存）
  {
    id: 'rel-7-different-merchant',
    buildingId: 'building-A',
    merchantId: 'merchant-multi-city',
    validity: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z',
    },
    expectAccepted: true,
  },
]

/**
 * 模拟 PG EXCLUDE 约束的应用层校验
 *
 * 真实 PG 约束在 INSERT/UPDATE 时由数据库拒绝；
 * SQLite 本地测试时通过事务内应用层校验模拟。
 *
 * 约束定义（M3.3 落地时）：
 *   EXCLUDE USING gist (
 *     building_id WITH =,
 *     merchant_id WITH =,
 *     tstzrange(starts_at, ends_at) WITH &&
 *   )
 *
 * 注意：不同 merchant 同一 building 允许并存（不触发约束）。
 */
export function simulatePgExclude(
  candidate: BuildingMerchantRelationFixture,
  existing: BuildingMerchantRelationFixture[],
): { accepted: boolean; overlapWith?: string[] } {
  const overlapWith: string[] = []
  for (const rel of existing) {
    // 仅在同一 (building_id, merchant_id) 下检查重叠
    if (
      rel.buildingId === candidate.buildingId &&
      rel.merchantId === candidate.merchantId &&
      periodsOverlap(rel.validity, candidate.validity)
    ) {
      overlapWith.push(rel.id)
    }
  }
  return {
    accepted: overlapWith.length === 0,
    overlapWith: overlapWith.length > 0 ? overlapWith : undefined,
  }
}

/**
 * 校验：所有 fixture 的 expectAccepted 与应用层模拟结果一致
 *
 * 用于确保 fixture 的预期与应用层校验逻辑保持同步。
 * 真实 PG 约束在 M3.3 落地后，将在 PG 环境单独验证。
 */
export function assertFixtureExpectationsInvariant(): void {
  // 假设所有已接受的关系已落库，逐个检查候选关系
  const accepted: BuildingMerchantRelationFixture[] = []
  for (const candidate of BUILDING_MERCHANT_RELATIONS) {
    const result = simulatePgExclude(candidate, accepted)
    if (result.accepted !== candidate.expectAccepted) {
      throw new Error(
        `fixture ${candidate.id} 预期 ${candidate.expectAccepted ? 'accepted' : 'rejected'},` +
          ` 实际 ${result.accepted ? 'accepted' : 'rejected'}` +
          (result.overlapWith ? `（与 ${result.overlapWith.join(', ')} 重叠）` : ''),
      )
    }
    if (result.accepted) {
      accepted.push(candidate)
    }
  }
}
