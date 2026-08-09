/**
 * domain/supply-submission 桶文件（投放房源提交）
 *
 * 对外只暴露纯函数与类型；集合 hook 由 collections/SupplySubmissions.ts 直接引用。
 */

export {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  FITOUT_STATUS_LABELS,
  FITOUT_STATUSES,
  LEASE_MODE_LABELS,
  LEASE_MODES,
  SUBMITTER_ROLE_LABELS,
  SUBMITTER_ROLES,
  SUPPLY_LIMITS,
  SUPPLY_SUBMISSION_STATUS_LABELS,
  SUPPLY_SUBMISSION_STATUSES,
  validateSupplySubmission,
  type CommissionMonths,
  type FitoutStatus,
  type LeaseMode,
  type SubmitterRole,
  type SupplySubmissionRequest,
  type SupplySubmissionStatus,
  type SupplyValidationResult,
} from './schema'

export {
  computeSupplyIdempotencyKey,
  computeSupplyIdempotencyKeySync,
} from './idempotency'

export {
  buildSupplyLogEntry,
  hashIpForLog,
  type SupplySubmissionLogEntry,
} from './privacy-log'
