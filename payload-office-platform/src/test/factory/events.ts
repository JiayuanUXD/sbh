/**
 * 领域事件 fixture（tasks.md M6.3 / design §3 domain_events / R8）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 消费器必须幂等，重复投递不能生成重复待办 / 通知 / 审计
 *
 * fixture 用途：
 *   - 单元测试：直接 import fixture，断言 publishEvent / dispatcher 行为
 *   - 集成测试：通过 seed 脚本写入 Outbox
 *
 * 注意：fixture 的 eventId 为测试稳定字符串，实际生产由 buildEventId() 生成 nanoid。
 */

import type { EventType } from '@/domain/workflow/event-types'
import type { DomainEvent } from '@/domain/workflow/event-publisher'

/** 房源发布事件 payload */
export interface ListingPublishedPayload {
  [k: string]: unknown
  listingId: string
  publicationStatus: 'published'
  reviewStatus: 'approved'
  actorId: string
}

/** 举报结论事件 payload（覆盖 sustained / partial / dismissed 三种结论） */
export interface ReportSustainedPayload {
  [k: string]: unknown
  reportId: string
  targetListingId: string
  conclusion: 'sustained' | 'partial' | 'dismissed'
  supplyPaused: boolean
  actorId: string
}

/** 线索分配事件 payload */
export interface LeadAssignedPayload {
  [k: string]: unknown
  leadId: string
  assigneeId: string
  previousAssigneeId: string | null
  assignerId: string
  runtimePolicyVersion: 'MVP-R1'
}

/** 房源已上架事件（listing.published） */
export const EVENT_FIXTURE_LISTING_PUBLISHED: DomainEvent<ListingPublishedPayload> = {
  eventId: 'evt_fixture_listing_published_001',
  eventType: 'listing.published' as EventType,
  aggregateType: 'listing',
  aggregateId: 'listing-published-clean',
  aggregateVersion: 4,
  payload: {
    listingId: 'listing-published-clean',
    publicationStatus: 'published',
    reviewStatus: 'approved',
    actorId: 'user-ops-1',
  },
  occurredAt: '2026-07-26T02:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 房源下架事件（listing.unpublished） */
export const EVENT_FIXTURE_LISTING_UNPUBLISHED: DomainEvent<ListingPublishedPayload> = {
  eventId: 'evt_fixture_listing_unpublished_001',
  eventType: 'listing.unpublished' as EventType,
  aggregateType: 'listing',
  aggregateId: 'listing-published-clean',
  aggregateVersion: 5,
  payload: {
    listingId: 'listing-published-clean',
    publicationStatus: 'published',
    reviewStatus: 'approved',
    actorId: 'user-ops-1',
  },
  occurredAt: '2026-07-26T03:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 举报成立事件（report.sustained） */
export const EVENT_FIXTURE_REPORT_SUSTAINED: DomainEvent<ReportSustainedPayload> = {
  eventId: 'evt_fixture_report_sustained_001',
  eventType: 'report.sustained' as EventType,
  aggregateType: 'report',
  aggregateId: 'report-closed-sustained',
  aggregateVersion: 6,
  payload: {
    reportId: 'report-closed-sustained',
    targetListingId: 'listing-published-pending-recheck',
    conclusion: 'sustained',
    supplyPaused: true,
    actorId: 'user-csr-1',
  },
  occurredAt: '2026-07-26T04:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 举报不成立事件（report.dismissed） */
export const EVENT_FIXTURE_REPORT_DISMISSED: DomainEvent<ReportSustainedPayload> = {
  eventId: 'evt_fixture_report_dismissed_001',
  eventType: 'report.dismissed' as EventType,
  aggregateType: 'report',
  aggregateId: 'report-closed-dismissed',
  aggregateVersion: 4,
  payload: {
    reportId: 'report-closed-dismissed',
    targetListingId: 'listing-published-clean',
    conclusion: 'dismissed',
    supplyPaused: false,
    actorId: 'user-csr-1',
  },
  occurredAt: '2026-07-26T05:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 线索已分配事件（lead.assigned） */
export const EVENT_FIXTURE_LEAD_ASSIGNED: DomainEvent<LeadAssignedPayload> = {
  eventId: 'evt_fixture_lead_assigned_001',
  eventType: 'lead.assigned' as EventType,
  aggregateType: 'lead',
  aggregateId: 'lead-001',
  aggregateVersion: 2,
  payload: {
    leadId: 'lead-001',
    assigneeId: 'user-broker-1',
    previousAssigneeId: null,
    assignerId: 'user-mgr-1',
    runtimePolicyVersion: 'MVP-R1',
  },
  occurredAt: '2026-07-26T06:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 线索已转派事件（lead.transferred） */
export const EVENT_FIXTURE_LEAD_TRANSFERRED: DomainEvent<LeadAssignedPayload> = {
  eventId: 'evt_fixture_lead_transferred_001',
  eventType: 'lead.transferred' as EventType,
  aggregateType: 'lead',
  aggregateId: 'lead-001',
  aggregateVersion: 3,
  payload: {
    leadId: 'lead-001',
    assigneeId: 'user-broker-2',
    previousAssigneeId: 'user-broker-1',
    assignerId: 'user-mgr-1',
    runtimePolicyVersion: 'MVP-R1',
  },
  occurredAt: '2026-07-26T07:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 跟进完成事件（followup.completed） */
export const EVENT_FIXTURE_FOLLOWUP_COMPLETED: DomainEvent<{
  [k: string]: unknown
  followupId: string
  leadId: string
  channel: 'phone' | 'wechat' | 'visit'
  actorId: string
}> = {
  eventId: 'evt_fixture_followup_completed_001',
  eventType: 'followup.completed' as EventType,
  aggregateType: 'followup',
  aggregateId: 'followup-001',
  aggregateVersion: 1,
  payload: {
    followupId: 'followup-001',
    leadId: 'lead-001',
    channel: 'phone',
    actorId: 'user-broker-1',
  },
  occurredAt: '2026-07-26T08:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** SLA 超时事件（sla.breached） */
export const EVENT_FIXTURE_SLA_BREACHED: DomainEvent<{
  [k: string]: unknown
  leadId: string
  slaType: 'first_followup' | 'claim_protection' | 'reclaim'
  breachedAt: string
  deadline: string
}> = {
  eventId: 'evt_fixture_sla_breached_001',
  eventType: 'sla.breached' as EventType,
  aggregateType: 'sla',
  aggregateId: 'lead-002',
  aggregateVersion: 1,
  payload: {
    leadId: 'lead-002',
    slaType: 'first_followup',
    breachedAt: '2026-07-26T08:00:00.000Z',
    deadline: '2026-07-26T06:00:00.000Z',
  },
  occurredAt: '2026-07-26T08:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** 已处理事件（用于幂等性测试，processedAt != null） */
export const EVENT_FIXTURE_ALREADY_PROCESSED: DomainEvent<ListingPublishedPayload> = {
  ...EVENT_FIXTURE_LISTING_PUBLISHED,
  eventId: 'evt_fixture_already_processed_001',
  occurredAt: '2026-07-25T10:00:00.000Z',
  processedAt: '2026-07-25T10:05:00.000Z',
  attemptCount: 1,
  lastError: null,
}

/** 已达重试上限事件（attemptCount = maxAttempts，用于死信测试） */
export const EVENT_FIXTURE_MAX_ATTEMPTS_REACHED: DomainEvent<ListingPublishedPayload> = {
  ...EVENT_FIXTURE_LISTING_PUBLISHED,
  eventId: 'evt_fixture_max_attempts_001',
  attemptCount: 5,
  lastError: '消费器持续失败：模拟下游不可用',
  processedAt: null,
}

/** 全部事件 fixture（用于遍历断言） */
export const EVENT_FIXTURES: Record<string, DomainEvent> = {
  'listing-published': EVENT_FIXTURE_LISTING_PUBLISHED,
  'listing-unpublished': EVENT_FIXTURE_LISTING_UNPUBLISHED,
  'report-sustained': EVENT_FIXTURE_REPORT_SUSTAINED,
  'report-dismissed': EVENT_FIXTURE_REPORT_DISMISSED,
  'lead-assigned': EVENT_FIXTURE_LEAD_ASSIGNED,
  'lead-transferred': EVENT_FIXTURE_LEAD_TRANSFERRED,
  'followup-completed': EVENT_FIXTURE_FOLLOWUP_COMPLETED,
  'sla-breached': EVENT_FIXTURE_SLA_BREACHED,
  'already-processed': EVENT_FIXTURE_ALREADY_PROCESSED,
  'max-attempts-reached': EVENT_FIXTURE_MAX_ATTEMPTS_REACHED,
}
