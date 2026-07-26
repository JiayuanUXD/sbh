/**
 * 商户 fixture（tasks.md M2.4）
 *
 * 业务不变量（AGENTS.md §5.6, tasks.md M2.4）：
 *   - 商户类型、联系人、服务城市、状态、资质有效期
 *   - 实现服务城市和资质有效性校验
 *   - 完成商户列表、详情、启停影响确认
 *
 * M0 阶段：仅产出 fixture，不写 Collection。
 */

import type { CityCode } from './teams'
import type { ValidityPeriod } from '@/domain/shared/validity'

export type MerchantType = 'individual' | 'company' | 'agency'

export type MerchantStatus = 'active' | 'inactive' | 'frozen'

export type QualificationStatus = 'valid' | 'expired' | 'pending'

export type MerchantFixture = {
  id: string
  name: string
  type: MerchantType
  /** 联系人姓名 */
  contactName: string
  /** 规范化手机号 */
  contactPhone: string
  /** 服务城市 */
  serviceCities: CityCode[]
  status: MerchantStatus
  /** 资质状态（独立于 status：商户可能 active 但资质过期） */
  qualificationStatus: QualificationStatus
  /** 资质有效期 */
  qualificationValidity: ValidityPeriod
  /** 商户创建时间 UTC ISO */
  createdAt: string
}

/** 商户矩阵：覆盖启 / 停 / 冻结 / 资质过期 / 多城市服务 */
export const MERCHANTS: Record<string, MerchantFixture> = {
  // 活跃 + 资质有效
  'merchant-active-shanghai': {
    id: 'merchant-active-shanghai',
    name: '上海商办服务',
    type: 'company',
    contactName: '李经理',
    contactPhone: '13800001001',
    serviceCities: ['shanghai'],
    status: 'active',
    qualificationStatus: 'valid',
    qualificationValidity: {
      startsAt: '2025-01-01T00:00:00.000Z',
      endsAt: '2027-12-31T23:59:59.000Z',
    },
    createdAt: '2024-06-01T00:00:00.000Z',
  },
  // 多城市服务
  'merchant-multi-city': {
    id: 'merchant-multi-city',
    name: '全国商办连锁',
    type: 'agency',
    contactName: '王总监',
    contactPhone: '13800001002',
    serviceCities: ['shanghai', 'beijing', 'shenzhen'],
    status: 'active',
    qualificationStatus: 'valid',
    qualificationValidity: {
      startsAt: '2025-01-01T00:00:00.000Z',
      endsAt: '2027-12-31T23:59:59.000Z',
    },
    createdAt: '2024-03-15T00:00:00.000Z',
  },
  // 停用
  'merchant-inactive': {
    id: 'merchant-inactive',
    name: '停用商办（已停）',
    type: 'company',
    contactName: '赵经理',
    contactPhone: '13800001003',
    serviceCities: ['shanghai'],
    status: 'inactive',
    qualificationStatus: 'valid',
    qualificationValidity: {
      startsAt: '2025-01-01T00:00:00.000Z',
      endsAt: '2027-12-31T23:59:59.000Z',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  // 冻结（M4.8 商户停用冻结场景）
  'merchant-frozen': {
    id: 'merchant-frozen',
    name: '冻结商办（资质问题）',
    type: 'company',
    contactName: '钱经理',
    contactPhone: '13800001004',
    serviceCities: ['beijing'],
    status: 'frozen',
    qualificationStatus: 'expired',
    qualificationValidity: {
      startsAt: '2023-01-01T00:00:00.000Z',
      endsAt: '2025-01-01T00:00:00.000Z', // 已过期
    },
    createdAt: '2023-01-01T00:00:00.000Z',
  },
  // 资质过期但商户仍 active（应阻止新建供给关系）
  'merchant-qual-expired': {
    id: 'merchant-qual-expired',
    name: '资质过期商办',
    type: 'individual',
    contactName: '孙经纪',
    contactPhone: '13800001005',
    serviceCities: ['shenzhen'],
    status: 'active',
    qualificationStatus: 'expired',
    qualificationValidity: {
      startsAt: '2023-06-01T00:00:00.000Z',
      endsAt: '2025-06-01T00:00:00.000Z', // 已过期
    },
    createdAt: '2023-06-01T00:00:00.000Z',
  },
  // 资质待审核
  'merchant-qual-pending': {
    id: 'merchant-qual-pending',
    name: '资质待审商办',
    type: 'company',
    contactName: '周经理',
    contactPhone: '13800001006',
    serviceCities: ['guangzhou'],
    status: 'active',
    qualificationStatus: 'pending',
    qualificationValidity: {
      startsAt: '2025-08-01T00:00:00.000Z',
      endsAt: '2027-08-01T00:00:00.000Z',
    },
    createdAt: '2025-08-01T00:00:00.000Z',
  },
}

/** 列出指定状态的商户 */
export function listMerchantsByStatus(status: MerchantStatus): MerchantFixture[] {
  return Object.values(MERCHANTS).filter((m) => m.status === status)
}

/** 列出指定资质状态的商户 */
export function listMerchantsByQualification(status: QualificationStatus): MerchantFixture[] {
  return Object.values(MERCHANTS).filter((m) => m.qualificationStatus === status)
}

/**
 * 业务规则校验：商户资质过期或服务城市不匹配时不能建立新供给关系
 *
 * 业务不变量（tasks.md M2 验收门）：
 *   - 商户资质过期或服务城市不匹配时不能建立新供给关系
 */
export function canEstablishSupplyRelation(
  merchant: MerchantFixture,
  listingCity: CityCode,
  asOf: Date,
): { ok: boolean; reason?: string } {
  if (merchant.status !== 'active') {
    return { ok: false, reason: `merchant_status_${merchant.status}` }
  }
  if (!merchant.serviceCities.includes(listingCity)) {
    return { ok: false, reason: 'service_city_not_covered' }
  }
  if (merchant.qualificationStatus === 'expired') {
    return { ok: false, reason: 'qualification_expired' }
  }
  if (merchant.qualificationStatus === 'pending') {
    return { ok: false, reason: 'qualification_pending' }
  }
  const qualStart = new Date(merchant.qualificationValidity.startsAt).getTime()
  const qualEnd =
    merchant.qualificationValidity.endsAt === null
      ? Number.POSITIVE_INFINITY
      : new Date(merchant.qualificationValidity.endsAt).getTime()
  const t = asOf.getTime()
  if (t < qualStart || t >= qualEnd) {
    return { ok: false, reason: 'qualification_out_of_validity_period' }
  }
  return { ok: true }
}
